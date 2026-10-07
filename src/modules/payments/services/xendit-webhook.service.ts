import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { paymentSessions } from "../../../db/schema/payment_sessions.schema.js";
import { paymentWebhookEvents } from "../../../db/schema/payment_webhook_events.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservationSettings } from "../../../db/schema/reservation_settings.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { recordReservationEvent } from "../../reservations/services/reservation-events.service.js";
import { readReservationFinancials } from "../../reservations/services/reservation-financials.service.js";

const SETTINGS_ID = "00000000-0000-4000-8000-000000000001";

type SessionEvent = "payment_session.completed" | "payment_session.expired";
type WebhookPayload = {
  event: SessionEvent;
  created?: string;
  data: {
    payment_session_id: string;
    reference_id: string;
    session_type: string;
    currency: string;
    amount: number;
    status: "COMPLETED" | "EXPIRED";
    payment_id?: string;
    updated?: string;
  };
};

export class XenditWebhookError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function isDashboardTestPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (payload.event !== "payment_session.completed" && payload.event !== "payment_session.expired")
    return false;
  if (!payload.data || typeof payload.data !== "object") return false;
  const data = payload.data as Record<string, unknown>;
  return (
    data.reference_id === "test_session" &&
    data.session_type === "SAVE" &&
    typeof data.id === "string" &&
    data.id.startsWith("ps-") &&
    data.currency === "IDR" &&
    Number.isSafeInteger(data.amount) &&
    Number(data.amount) > 0 &&
    data.status === (payload.event === "payment_session.completed" ? "COMPLETED" : "EXPIRED")
  );
}

function parsePayload(value: unknown): WebhookPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    payload.event !== "payment_session.completed" &&
    payload.event !== "payment_session.expired"
  ) {
    return null;
  }
  if (!payload.data || typeof payload.data !== "object") {
    throw new XenditWebhookError("INVALID_WEBHOOK", "Missing payment session data", 400);
  }
  const data = payload.data as Record<string, unknown>;
  const expectedStatus = payload.event === "payment_session.completed" ? "COMPLETED" : "EXPIRED";
  const sessionId = data.payment_session_id ?? data.id;
  if (
    typeof sessionId !== "string" ||
    !sessionId ||
    typeof data.reference_id !== "string" ||
    !data.reference_id ||
    data.session_type !== "PAY" ||
    data.currency !== "IDR" ||
    !Number.isSafeInteger(data.amount) ||
    Number(data.amount) <= 0 ||
    data.status !== expectedStatus ||
    (payload.event === "payment_session.completed" &&
      (typeof data.payment_id !== "string" || !data.payment_id))
  ) {
    throw new XenditWebhookError("INVALID_WEBHOOK", "Invalid payment session event", 400);
  }
  return { ...payload, data: { ...data, payment_session_id: sessionId } } as WebhookPayload;
}

export async function processXenditWebhook(db: Database, rawPayload: unknown) {
  // The dashboard sends a SAVE-session fixture that has no matching reservation.
  if (isDashboardTestPayload(rawPayload)) {
    return { received: true, ignored: true, reason: "dashboard_test" };
  }
  const payload = parsePayload(rawPayload);
  if (!payload) return { received: true, ignored: true };
  const { data, event } = payload;
  const eventId = createHash("sha256")
    .update(`${event}:${data.payment_session_id}:${data.payment_id ?? ""}`)
    .digest("hex");
  const [lookup] = await db
    .select({ reservationId: paymentSessions.reservationId })
    .from(paymentSessions)
    .where(
      and(
        eq(paymentSessions.referenceId, data.reference_id),
        eq(paymentSessions.provider, "xendit"),
      ),
    )
    .limit(1);
  if (!lookup) {
    throw new XenditWebhookError("SESSION_NOT_FOUND", "Payment session is not available yet", 503);
  }

  return db.transaction(async (tx) => {
    // Lock the reservation first. All website payment callbacks use the same lock order.
    const [reservation] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, lookup.reservationId))
      .for("update")
      .limit(1);
    const [session] = await tx
      .select()
      .from(paymentSessions)
      .where(
        and(
          eq(paymentSessions.referenceId, data.reference_id),
          eq(paymentSessions.provider, "xendit"),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !reservation ||
      !session ||
      reservation.source !== "website" ||
      session.reservationId !== reservation.id
    ) {
      throw new XenditWebhookError(
        "SESSION_MISMATCH",
        "Payment session does not match a website reservation",
        409,
      );
    }
    if (
      (session.providerSessionId && session.providerSessionId !== data.payment_session_id) ||
      session.amount !== data.amount ||
      session.currency !== data.currency
    ) {
      throw new XenditWebhookError("SESSION_MISMATCH", "Payment session details do not match", 409);
    }
    const [webhookEvent] = await tx
      .insert(paymentWebhookEvents)
      .values({
        provider: "xendit",
        eventId,
        eventType: event,
        paymentSessionId: session.id,
        payload: rawPayload,
      })
      .onConflictDoNothing()
      .returning();
    if (!webhookEvent) return { received: true, duplicate: true };

    const now = new Date();
    if (event === "payment_session.expired") {
      // A completed payment is authoritative even if an expiry event arrives later.
      if (session.status !== "completed") {
        await tx
          .update(paymentSessions)
          .set({
            status: "expired",
            providerSessionId: data.payment_session_id,
            updatedAt: now,
          })
          .where(eq(paymentSessions.id, session.id));
        if (reservation.reservationStatus === "pending" && reservation.paymentStatus === "unpaid") {
          await tx
            .update(reservations)
            .set({
              reservationStatus: "expired",
              paymentStatus: "expired",
              expiredAt: now,
              version: sql`${reservations.version} + 1`,
              updatedAt: now,
            })
            .where(eq(reservations.id, reservation.id));
          await recordReservationEvent(tx, {
            reservationId: reservation.id,
            eventType: "reservation.expired",
            actorType: "gateway",
            reservationStatusBefore: "pending",
            reservationStatusAfter: "expired",
            paymentStatusBefore: "unpaid",
            paymentStatusAfter: "expired",
            referenceId: data.payment_session_id,
            details: { reason: "xendit_payment_session_expired", paymentSessionId: session.id },
          });
        }
      }
      await tx
        .update(paymentWebhookEvents)
        .set({ processedAt: now })
        .where(eq(paymentWebhookEvents.id, webhookEvent.id));
      return { received: true, outcome: "expired" };
    }

    const [method] = await tx
      .select({ id: masterItems.id })
      .from(masterItems)
      .where(
        and(eq(masterItems.category, "payment_methods"), eq(masterItems.code, "payment_gateway")),
      )
      .limit(1);
    if (!method)
      throw new XenditWebhookError(
        "PAYMENT_METHOD_MISSING",
        "Payment gateway method is not configured",
        503,
      );
    const paidAt =
      data.updated && !Number.isNaN(Date.parse(data.updated)) ? new Date(data.updated) : now;
    const [sessionPayment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.paymentSessionId, session.id))
      .limit(1);
    if (sessionPayment && sessionPayment.providerReference !== data.payment_id) {
      throw new XenditWebhookError(
        "PAYMENT_MISMATCH",
        "Payment session already has a different payment",
        409,
      );
    }
    const [existingPayment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, "xendit"), eq(payments.providerReference, data.payment_id!)))
      .limit(1);
    if (
      existingPayment &&
      (existingPayment.reservationId !== reservation.id ||
        existingPayment.paymentSessionId !== session.id ||
        existingPayment.amount !== session.amount)
    ) {
      throw new XenditWebhookError(
        "PAYMENT_MISMATCH",
        "Payment reference belongs to another transaction",
        409,
      );
    }
    const [payment] = existingPayment
      ? [existingPayment]
      : await tx
          .insert(payments)
          .values({
            reservationId: reservation.id,
            methodId: method.id,
            paymentSessionId: session.id,
            provider: "xendit",
            providerReference: data.payment_id!,
            amount: session.amount,
            status: "succeeded",
            paidAt,
            idempotencyKey: `xendit:${data.payment_id}`,
          })
          .returning();
    await tx
      .update(paymentSessions)
      .set({
        status: "completed",
        providerSessionId: data.payment_session_id,
        completedAt: paidAt,
        updatedAt: now,
      })
      .where(eq(paymentSessions.id, session.id));
    const financials = await readReservationFinancials(tx, reservation.id);
    const nextPaymentStatus = financials.remainingBalance === 0 ? "paid" : "partial";
    const afterDeadline = !reservation.paymentExpiresAt || paidAt > reservation.paymentExpiresAt;
    const mustExpire = reservation.reservationStatus === "pending" && afterDeadline;
    const [settings] = await tx
      .select({ autoConfirm: reservationSettings.autoConfirmWebsiteAfterPayment })
      .from(reservationSettings)
      .where(eq(reservationSettings.id, SETTINGS_ID))
      .limit(1);
    const shouldConfirm =
      reservation.reservationStatus === "pending" &&
      !afterDeadline &&
      nextPaymentStatus === "paid" &&
      (settings?.autoConfirm ?? true);
    const nextReservationStatus = mustExpire
      ? "expired"
      : shouldConfirm
        ? "confirmed"
        : reservation.reservationStatus;
    await tx
      .update(reservations)
      .set({
        reservationStatus: nextReservationStatus,
        paymentStatus: nextPaymentStatus,
        ...(mustExpire ? { expiredAt: now } : {}),
        ...(shouldConfirm ? { confirmedAt: now } : {}),
        version: sql`${reservations.version} + 1`,
        updatedAt: now,
      })
      .where(eq(reservations.id, reservation.id));
    if (!existingPayment) {
      await recordReservationEvent(tx, {
        reservationId: reservation.id,
        eventType: "payment.recorded",
        actorType: "gateway",
        reservationStatusBefore: reservation.reservationStatus,
        reservationStatusAfter: nextReservationStatus,
        paymentStatusBefore: reservation.paymentStatus,
        paymentStatusAfter: nextPaymentStatus,
        referenceId: data.payment_id,
        details: {
          paymentId: payment.id,
          paymentSessionId: session.id,
          amount: payment.amount,
          provider: "xendit",
          requiresManualReview:
            afterDeadline || ["expired", "cancelled"].includes(reservation.reservationStatus),
        },
      });
    }
    if (mustExpire || shouldConfirm) {
      await recordReservationEvent(tx, {
        reservationId: reservation.id,
        eventType: mustExpire ? "reservation.expired" : "reservation.confirmed",
        actorType: "gateway",
        reservationStatusBefore: reservation.reservationStatus,
        reservationStatusAfter: nextReservationStatus,
        paymentStatusBefore: reservation.paymentStatus,
        paymentStatusAfter: nextPaymentStatus,
        referenceId: data.payment_session_id,
        details: {
          paymentSessionId: session.id,
          reason: mustExpire ? "payment_completed_after_expiry" : "website_payment_completed",
        },
      });
    }
    await tx
      .update(paymentWebhookEvents)
      .set({ paymentId: payment.id, processedAt: now })
      .where(eq(paymentWebhookEvents.id, webhookEvent.id));
    return {
      received: true,
      outcome: nextReservationStatus,
      requiresManualReview:
        afterDeadline || ["expired", "cancelled"].includes(reservation.reservationStatus),
    };
  });
}
