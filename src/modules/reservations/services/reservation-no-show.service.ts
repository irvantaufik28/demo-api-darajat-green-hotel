import { eq, sql } from "drizzle-orm";
import { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { recordReservationEvent } from "./reservation-events.service.js";
import { calculateNoShowSettlement } from "./reservation-no-show-settlement.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class NoShowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

function jakartaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function markReservationNoShow(
  tx: Transaction,
  input: {
    reservationId: string;
    reason: string;
    actorType: "user" | "system";
    actorUserId?: string | null;
    markedAt?: Date;
  },
) {
  const [reservation] = await tx
    .select()
    .from(reservations)
    .where(eq(reservations.id, input.reservationId))
    .for("update")
    .limit(1);
  if (!reservation) throw new NoShowError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
  if (reservation.reservationStatus !== "confirmed" || reservation.checkedInAt) {
    throw new NoShowError(
      "NO_SHOW_NOT_ALLOWED",
      "Only a confirmed reservation that has not checked in can be marked no-show",
    );
  }

  if (reservation.checkInDate > jakartaDate(input.markedAt)) {
    throw new NoShowError(
      "NO_SHOW_TOO_EARLY",
      "Reservation can only be marked no-show on or after the check-in date",
    );
  }

  const settlement = await calculateNoShowSettlement(tx, reservation);
  const noShowAt = input.markedAt ?? new Date();
  const reason = input.reason.trim();
  await tx
    .update(reservations)
    .set({
      reservationStatus: "no_show",
      noShowAt,
      noShowReason: reason,
      noShowMarkedByUserId: input.actorUserId ?? null,
      noShowChargeAmount: settlement.amounts.noShowCharge,
      noShowSettlementSnapshot: settlement,
      version: sql`${reservations.version} + 1`,
      updatedAt: noShowAt,
    })
    .where(eq(reservations.id, reservation.id));

  await recordReservationEvent(tx, {
    reservationId: reservation.id,
    eventType: "reservation.no_show",
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    occurredAt: noShowAt,
    reservationStatusBefore: "confirmed",
    reservationStatusAfter: "no_show",
    paymentStatusBefore: reservation.paymentStatus,
    paymentStatusAfter: reservation.paymentStatus,
    details: {
      reason,
      calculationStatus: settlement.calculationStatus,
      settlementStatus: settlement.settlementStatus,
      strategy: settlement.strategy,
      noShowCharge: settlement.amounts.noShowCharge,
      paymentAppliedToPenalty: settlement.amounts.paymentAppliedToPenalty,
      uncollectedPenaltyAmount: settlement.amounts.uncollectedPenaltyAmount,
      estimatedAmountDue: settlement.amounts.estimatedAmountDue,
      depositReturnRequired: settlement.amounts.depositReturnRequired,
      reviewReasons: settlement.reviewReasons,
      inventoryReleased: true,
      automated: input.actorType === "system",
    },
  });

  return {
    reservationId: reservation.id,
    bookingCode: reservation.bookingCode,
    reservationStatus: "no_show" as const,
    paymentStatus: reservation.paymentStatus,
    noShowAt,
    noShowReason: reason,
    inventoryReleased: true,
    settlement,
  };
}
