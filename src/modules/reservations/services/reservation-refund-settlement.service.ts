import type { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { calculateCancellationSettlement } from "./reservation-cancellation-settlement.service.js";
import type { readReservationFinancials } from "./reservation-financials.service.js";
import { calculateNoShowSettlement } from "./reservation-no-show-settlement.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;
type Reservation = typeof reservations.$inferSelect;

export function refundAllowed(reservation: Reservation) {
  return (
    reservation.reservationStatus === "cancelled" || reservation.reservationStatus === "no_show"
  );
}

export async function calculateRefundSettlement(
  db: QueryDatabase,
  reservation: Reservation,
  existingFinancials?: Awaited<ReturnType<typeof readReservationFinancials>>,
) {
  if (reservation.reservationStatus !== "no_show") {
    return {
      kind: "cancellation" as const,
      ...(await calculateCancellationSettlement(db, reservation, existingFinancials)),
    };
  }

  const settlement = await calculateNoShowSettlement(db, reservation);
  return {
    kind: "no_show" as const,
    calculationStatus: settlement.calculationStatus,
    reviewReasons: settlement.reviewReasons,
    policy: {
      name: "No-show",
      daysBeforeCheckIn: -1,
      appliedRule: null,
      rooms: [],
    },
    amounts: {
      bookingTotal: settlement.amounts.bookingTotal,
      roomTotal: settlement.amounts.roomTotal,
      otherCharges: settlement.amounts.otherCharges,
      netPaidAmount: settlement.amounts.netPaidAmount,
      cancellationCharge: settlement.amounts.noShowCharge,
      maximumRefundWithoutOverride: settlement.amounts.maximumRefundWithoutOverride,
      estimatedRefundAmount: settlement.amounts.maximumRefundWithoutOverride,
    },
  };
}
