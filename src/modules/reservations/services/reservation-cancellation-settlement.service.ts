import { asc, eq } from "drizzle-orm";
import { reservationRoomNights } from "../../../db/schema/reservation_room_nights.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import type { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { readReservationFinancials } from "./reservation-financials.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;
type Reservation = typeof reservations.$inferSelect;
type CancellationRule = {
  id?: string;
  timingType: "more_than" | "within";
  daysBefore: number;
  chargeType: "percentage" | "fixed" | "nights";
  chargeValue: number;
  sortOrder: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRule(value: unknown): CancellationRule | null {
  if (!isRecord(value)) return null;
  if (value.timingType !== "more_than" && value.timingType !== "within") return null;
  if (!["percentage", "fixed", "nights"].includes(String(value.chargeType))) return null;
  if (!Number.isInteger(value.daysBefore) || Number(value.daysBefore) < 0) return null;
  if (!Number.isInteger(value.chargeValue) || Number(value.chargeValue) < 0) return null;
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    timingType: value.timingType,
    daysBefore: Number(value.daysBefore),
    chargeType: value.chargeType as CancellationRule["chargeType"],
    chargeValue: Number(value.chargeValue),
    sortOrder: Number.isInteger(value.sortOrder) ? Number(value.sortOrder) : 0,
  };
}

function calendarDaysBefore(checkInDate: string, cancelledAt: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(cancelledAt);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  const cancelledDate = `${value("year")}-${value("month")}-${value("day")}`;
  return Math.round(
    (Date.parse(`${checkInDate}T00:00:00Z`) - Date.parse(`${cancelledDate}T00:00:00Z`)) /
      86_400_000,
  );
}

export async function calculateCancellationSettlement(db: QueryDatabase, reservation: Reservation) {
  if (reservation.reservationStatus !== "cancelled" || !reservation.cancelledAt) {
    throw new Error("Cancellation settlement requires a cancelled reservation");
  }

  const [financials, roomNights] = await Promise.all([
    readReservationFinancials(db, reservation.id),
    db
      .select({
        reservationRoomId: reservationRoomNights.reservationRoomId,
        stayDate: reservationRoomNights.stayDate,
        finalPrice: reservationRoomNights.finalPrice,
      })
      .from(reservationRoomNights)
      .innerJoin(reservationRooms, eq(reservationRoomNights.reservationRoomId, reservationRooms.id))
      .where(eq(reservationRooms.reservationId, reservation.id))
      .orderBy(asc(reservationRoomNights.stayDate)),
  ]);

  const {
    bookingTotal,
    roomTotal,
    otherCharges,
    grossPaidAmount,
    refundedAmount,
    netPaidAmount,
    depositBalance,
  } = financials;
  const reviewReasons: string[] = [];
  const snapshot = reservation.cancellationPolicySnapshot;
  const daysBeforeCheckIn = calendarDaysBefore(reservation.checkInDate, reservation.cancelledAt);
  let policyName: string | null = null;
  let appliedRule: CancellationRule | null = null;
  let cancellationCharge: number | null = null;

  if (isRecord(snapshot) && snapshot.type === "non_refundable") {
    policyName = typeof snapshot.name === "string" ? snapshot.name : "Non-refundable";
    cancellationCharge = roomTotal;
  } else if (isRecord(snapshot) && isRecord(snapshot.policy) && Array.isArray(snapshot.rules)) {
    policyName = typeof snapshot.policy.name === "string" ? snapshot.policy.name : null;
    const rules = snapshot.rules.map(parseRule);
    if (rules.some((rule) => rule === null)) {
      reviewReasons.push("Policy snapshot contains an invalid cancellation rule");
    } else {
      appliedRule =
        (rules as CancellationRule[])
          .filter((rule) =>
            rule.timingType === "more_than"
              ? daysBeforeCheckIn > rule.daysBefore
              : daysBeforeCheckIn <= rule.daysBefore,
          )
          .sort((left, right) => left.sortOrder - right.sortOrder)[0] ?? null;
      if (!appliedRule) {
        reviewReasons.push("No cancellation rule matches the cancellation date");
      } else if (appliedRule.chargeType === "percentage") {
        cancellationCharge = Math.min(
          roomTotal,
          Math.round((roomTotal * appliedRule.chargeValue) / 100),
        );
      } else if (appliedRule.chargeType === "fixed") {
        cancellationCharge = Math.min(roomTotal, appliedRule.chargeValue);
      } else if (!roomNights.length && roomTotal > 0) {
        reviewReasons.push("Room-night prices are required for a nights-based cancellation rule");
      } else if (roomNights.reduce((sum, night) => sum + night.finalPrice, 0) !== roomTotal) {
        reviewReasons.push("Room-night prices do not match the room charges");
      } else {
        const nightsByRoom = new Map<string, number>();
        cancellationCharge = Math.min(
          roomTotal,
          roomNights.reduce((sum, night) => {
            const position = nightsByRoom.get(night.reservationRoomId) ?? 0;
            nightsByRoom.set(night.reservationRoomId, position + 1);
            return sum + (position < appliedRule!.chargeValue ? night.finalPrice : 0);
          }, 0),
        );
      }
    }
  } else {
    reviewReasons.push("No cancellation policy snapshot is stored for this reservation");
  }

  if (otherCharges !== 0) {
    reviewReasons.push("Extra beds, breakfast, experiences, or adjustments need separate review");
  }
  const calculationStatus = reviewReasons.length ? "manual_review_required" : "calculated";
  return {
    reservationId: reservation.id,
    bookingCode: reservation.bookingCode,
    cancelledAt: reservation.cancelledAt,
    source: reservation.source,
    calculationStatus,
    reviewReasons,
    policy: {
      id: reservation.cancellationPolicyId,
      name: policyName,
      daysBeforeCheckIn,
      appliedRule,
    },
    amounts: {
      bookingTotal,
      roomTotal,
      otherCharges,
      grossPaidAmount,
      refundedAmount,
      netPaidAmount,
      depositBalance,
      cancellationCharge,
      estimatedRefundAmount:
        calculationStatus === "calculated" && cancellationCharge !== null
          ? Math.max(0, netPaidAmount - cancellationCharge)
          : null,
      estimatedAmountDue:
        calculationStatus === "calculated" && cancellationCharge !== null
          ? Math.max(0, cancellationCharge - netPaidAmount)
          : null,
    },
  };
}
