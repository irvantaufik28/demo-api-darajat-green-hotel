import { asc, eq } from "drizzle-orm";
import { reservationRoomNights } from "../../../db/schema/reservation_room_nights.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import type { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { readReservationFinancials } from "./reservation-financials.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;
type Reservation = typeof reservations.$inferSelect;
type NoShowChargeType = "percentage" | "first_night" | "full_stay";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function policyFromSnapshot(value: unknown) {
  if (!isRecord(value)) return null;
  if (value.type === "non_refundable") {
    return {
      name: typeof value.name === "string" ? value.name : "Non-refundable",
      type: "full_stay" as const,
      value: 100,
    };
  }
  const policy = isRecord(value.policy) ? value.policy : value;
  const type = policy.noShowChargeType;
  const amount = policy.noShowChargeValue;
  if (
    !["percentage", "first_night", "full_stay"].includes(String(type)) ||
    !Number.isInteger(amount) ||
    Number(amount) < 0
  ) {
    return null;
  }
  return {
    name: typeof policy.name === "string" ? policy.name : null,
    type: type as NoShowChargeType,
    value: Number(amount),
  };
}

function calculateCharge(
  policy: NonNullable<ReturnType<typeof policyFromSnapshot>>,
  total: number,
  firstNight: number,
) {
  if (policy.type === "percentage") {
    return Math.min(total, Math.round((total * Math.min(100, policy.value)) / 100));
  }
  if (policy.type === "first_night") return Math.min(total, firstNight);
  return total;
}

export async function calculateNoShowSettlement(db: QueryDatabase, reservation: Reservation) {
  const [financials, rooms, nights] = await Promise.all([
    readReservationFinancials(db, reservation.id),
    db
      .select({ id: reservationRooms.id, name: reservationRooms.roomTypeNameSnapshot })
      .from(reservationRooms)
      .where(eq(reservationRooms.reservationId, reservation.id))
      .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id)),
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
  const reviewReasons: string[] = [];
  const breakdown: Array<{
    reservationRoomId: string;
    roomTypeName: string;
    policyName: string | null;
    chargeType: NoShowChargeType | null;
    chargeValue: number | null;
    roomTotal: number;
    noShowCharge: number | null;
  }> = [];
  const snapshot = reservation.cancellationPolicySnapshot;

  if (isRecord(snapshot) && snapshot.type === "per_room" && Array.isArray(snapshot.rooms)) {
    for (const room of rooms) {
      const entry = snapshot.rooms.find(
        (item) => isRecord(item) && item.reservationRoomId === room.id,
      );
      const roomNights = nights.filter((night) => night.reservationRoomId === room.id);
      const roomTotal = roomNights.reduce((sum, night) => sum + night.finalPrice, 0);
      const policy = isRecord(entry) ? policyFromSnapshot(entry.snapshot) : null;
      if (!policy) reviewReasons.push(`No-show policy is missing for ${room.name}`);
      breakdown.push({
        reservationRoomId: room.id,
        roomTypeName: room.name,
        policyName: policy?.name ?? null,
        chargeType: policy?.type ?? null,
        chargeValue: policy?.value ?? null,
        roomTotal,
        noShowCharge: policy
          ? calculateCharge(policy, roomTotal, roomNights[0]?.finalPrice ?? 0)
          : null,
      });
    }
  } else if (isRecord(snapshot) && snapshot.type === "non_refundable") {
    for (const room of rooms) {
      const roomNights = nights.filter((night) => night.reservationRoomId === room.id);
      const roomTotal = roomNights.reduce((sum, night) => sum + night.finalPrice, 0);
      breakdown.push({
        reservationRoomId: room.id,
        roomTypeName: room.name,
        policyName: typeof snapshot.name === "string" ? snapshot.name : "Non-refundable",
        chargeType: "full_stay",
        chargeValue: 100,
        roomTotal,
        noShowCharge: roomTotal,
      });
    }
  } else {
    const policy = policyFromSnapshot(snapshot);
    if (!policy) reviewReasons.push("No-show policy is missing from the reservation snapshot");
    for (const room of rooms) {
      const roomNights = nights.filter((night) => night.reservationRoomId === room.id);
      const roomTotal = roomNights.reduce((sum, night) => sum + night.finalPrice, 0);
      breakdown.push({
        reservationRoomId: room.id,
        roomTypeName: room.name,
        policyName: policy?.name ?? null,
        chargeType: policy?.type ?? null,
        chargeValue: policy?.value ?? null,
        roomTotal,
        noShowCharge: policy
          ? calculateCharge(policy, roomTotal, roomNights[0]?.finalPrice ?? 0)
          : null,
      });
    }
  }

  const charge = reviewReasons.length
    ? null
    : breakdown.reduce((sum, room) => sum + (room.noShowCharge ?? 0), 0);
  return {
    calculationStatus: reviewReasons.length ? "manual_review_required" : "calculated",
    reviewReasons,
    policy: { rooms: breakdown },
    amounts: {
      bookingTotal: financials.bookingTotal,
      roomTotal: financials.roomTotal,
      otherCharges: financials.otherCharges,
      netPaidAmount: financials.netPaidAmount,
      depositBalance: financials.depositBalance,
      noShowCharge: charge,
      maximumRefundWithoutOverride:
        charge === null ? null : Math.max(0, financials.netPaidAmount - charge),
      estimatedAmountDue: charge === null ? null : Math.max(0, charge - financials.netPaidAmount),
    },
  };
}
