import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { AppConfig } from "../../../config/env.js";
import { guests } from "../../../db/schema/guests.schema.js";
import { paymentSessions } from "../../../db/schema/payment_sessions.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { readReservationFinancials } from "./reservation-financials.service.js";
import { recordReservationEvent } from "./reservation-events.service.js";

export class CheckoutSessionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

type XenditSession = {
  payment_session_id: string;
  reference_id: string;
  payment_link_url: string | null;
  amount: number;
  currency: string;
  status: string;
  expires_at: string;
};

function response(row: typeof paymentSessions.$inferSelect) {
  return {
    paymentSessionId: row.id,
    providerSessionId: row.providerSessionId,
    status: row.status,
    checkoutUrl: row.checkoutUrl,
    amount: row.amount,
    currency: row.currency,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function createWebsitePaymentSession(
  db: Database,
  reservationId: string,
  xendit: NonNullable<AppConfig["xendit"]>,
) {
  const claim = await db.transaction(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(reservations)
      .where(eq(reservations.id, reservationId))
      .for("update")
      .limit(1);
    if (!reservation || reservation.source !== "website") {
      throw new CheckoutSessionError("RESERVATION_NOT_FOUND", "Website reservation not found", 404);
    }
    if (reservation.reservationStatus !== "pending" || reservation.paymentStatus !== "unpaid") {
      throw new CheckoutSessionError(
        "PAYMENT_NOT_ALLOWED",
        "Reservation is not awaiting website payment",
        409,
      );
    }
    if (!reservation.paymentExpiresAt || reservation.paymentExpiresAt <= new Date()) {
      throw new CheckoutSessionError(
        "RESERVATION_EXPIRED",
        "Website payment time has expired",
        409,
      );
    }
    const [existing] = await tx
      .select()
      .from(paymentSessions)
      .where(
        and(
          eq(paymentSessions.reservationId, reservationId),
          eq(paymentSessions.provider, "xendit"),
          inArray(paymentSessions.status, ["active", "creating"]),
        ),
      )
      .orderBy(paymentSessions.createdAt)
      .limit(1);
    if (existing && ["active", "creating"].includes(existing.status)) {
      return { existing };
    }
    const remainingMs = reservation.paymentExpiresAt.getTime() - Date.now();
    if (remainingMs < 610_000) {
      throw new CheckoutSessionError(
        "INSUFFICIENT_PAYMENT_TIME",
        "At least 10 minutes must remain to start Xendit checkout",
        409,
      );
    }
    const financials = await readReservationFinancials(tx, reservationId);
    if (!Number.isSafeInteger(financials.remainingBalance) || financials.remainingBalance <= 0) {
      throw new CheckoutSessionError(
        "INVALID_PAYMENT_AMOUNT",
        "Reservation has no payable balance",
        409,
      );
    }
    const [guest] = await tx
      .select({
        id: guests.id,
        fullName: guests.fullName,
        email: guests.email,
        phone: guests.phone,
      })
      .from(guests)
      .where(eq(guests.id, reservation.guestId))
      .limit(1);
    if (!guest)
      throw new CheckoutSessionError("GUEST_NOT_FOUND", "Reservation guest not found", 409);
    const referenceId = `GH-${reservation.id.replaceAll("-", "")}-${randomUUID().slice(0, 8)}`;
    const [created] = await tx
      .insert(paymentSessions)
      .values({
        reservationId,
        referenceId,
        amount: financials.remainingBalance,
        expiresAt: reservation.paymentExpiresAt,
        status: "creating",
      })
      .returning();
    return { created, bookingCode: reservation.bookingCode, guest };
  });

  if ("existing" in claim && claim.existing) return { ...response(claim.existing), replayed: true };
  const { created, bookingCode, guest } = claim;
  const successUrl = new URL("/booking/payment/success", xendit.websiteBaseUrl);
  successUrl.searchParams.set("booking", bookingCode);
  const resultUrl = new URL("/booking/payment/result", xendit.websiteBaseUrl);
  resultUrl.searchParams.set("booking", bookingCode);
  const firstName = guest.fullName.trim().split(/\s+/)[0] || "Guest";
  const surname = guest.fullName.trim().split(/\s+/).slice(1).join(" ") || firstName;
  const payload = {
    reference_id: created.referenceId,
    session_type: "PAY",
    mode: "PAYMENT_LINK",
    capture_method: "AUTOMATIC",
    amount: created.amount,
    currency: "IDR",
    country: "ID",
    customer: {
      reference_id: guest.id.replaceAll("-", ""),
      type: "INDIVIDUAL",
      ...(guest.email && guest.email.length <= 50 ? { email: guest.email } : {}),
      ...(guest.phone ? { mobile_number: guest.phone } : {}),
      individual_detail: { given_names: firstName, surname },
    },
    expires_at: created.expiresAt.toISOString(),
    description: `Green Hero booking ${bookingCode}`,
    success_return_url: successUrl.toString(),
    cancel_return_url: resultUrl.toString(),
    metadata: { reservation_id: reservationId },
  };
  let remote: Response;
  try {
    remote = await fetch(new URL("/sessions", xendit.apiBaseUrl), {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${xendit.secretKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CheckoutSessionError(
      "PAYMENT_SESSION_PENDING_RECONCILIATION",
      "Xendit response is uncertain; checkout is being reconciled",
      503,
    );
  }
  if (!remote.ok) {
    const errorPayload = (await remote.json().catch(() => null)) as {
      error_code?: unknown;
      message?: unknown;
    } | null;
    console.log("Xendit payment session creation failed", {
      httpStatus: remote.status,
      errorCode: typeof errorPayload?.error_code === "string" ? errorPayload.error_code : null,
      message: typeof errorPayload?.message === "string" ? errorPayload.message : null,
    });
    if (remote.status >= 400 && remote.status < 500) {
      await db
        .update(paymentSessions)
        .set({
          status: "failed",
          lastError: `Xendit rejected session creation (${remote.status})`,
          updatedAt: new Date(),
        })
        .where(eq(paymentSessions.id, created.id));
    }
    throw new CheckoutSessionError(
      "XENDIT_SESSION_FAILED",
      "Unable to create Xendit checkout session",
      502,
    );
  }
  let remoteSession: XenditSession;
  try {
    remoteSession = (await remote.json()) as XenditSession;
  } catch {
    throw new CheckoutSessionError(
      "PAYMENT_SESSION_PENDING_RECONCILIATION",
      "Xendit returned an unreadable session",
      503,
    );
  }
  if (
    remoteSession.reference_id !== created.referenceId ||
    remoteSession.amount !== created.amount ||
    remoteSession.currency !== "IDR" ||
    remoteSession.status !== "ACTIVE" ||
    !remoteSession.payment_session_id ||
    !remoteSession.payment_link_url ||
    new Date(remoteSession.expires_at).getTime() !== created.expiresAt.getTime()
  ) {
    throw new CheckoutSessionError(
      "PAYMENT_SESSION_MISMATCH",
      "Xendit session requires reconciliation",
      502,
    );
  }
  const saved = await db.transaction(async (tx) => {
    const [session] = await tx
      .update(paymentSessions)
      .set({
        status: "active",
        providerSessionId: remoteSession.payment_session_id,
        checkoutUrl: remoteSession.payment_link_url,
        updatedAt: new Date(),
      })
      .where(and(eq(paymentSessions.id, created.id), eq(paymentSessions.status, "creating")))
      .returning();
    if (!session)
      throw new CheckoutSessionError(
        "PAYMENT_SESSION_CONFLICT",
        "Checkout session changed while creating",
        409,
      );
    await recordReservationEvent(tx, {
      reservationId,
      eventType: "payment_session.created",
      actorType: "system",
      reservationStatusBefore: "pending",
      reservationStatusAfter: "pending",
      paymentStatusBefore: "unpaid",
      paymentStatusAfter: "unpaid",
      referenceId: session.id,
      details: {
        provider: "xendit",
        providerSessionId: session.providerSessionId,
        amount: session.amount,
        expiresAt: session.expiresAt.toISOString(),
      },
    });
    return session;
  });
  return { ...response(saved), replayed: false };
}
