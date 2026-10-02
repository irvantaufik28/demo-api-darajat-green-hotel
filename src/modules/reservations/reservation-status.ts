import { reservationPaymentStatusEnum, reservationStatusEnum } from "../../db/schema/status.enums.js";

export type ReservationStatus = (typeof reservationStatusEnum.enumValues)[number];
export type ReservationPaymentStatus = (typeof reservationPaymentStatusEnum.enumValues)[number];

export type OperationalStatus =
  | "awaiting_confirmation"
  | "upcoming"
  | "ready_to_check_in"
  | "in_house"
  | "due_out"
  | "overdue"
  | "checked_out"
  | "cancelled"
  | "expired";

export const reservationStatusTransitions: Record<ReservationStatus, readonly ReservationStatus[]> = {
  pending: ["confirmed", "cancelled", "expired"],
  confirmed: ["checked_in", "cancelled"],
  checked_in: ["checked_out"],
  checked_out: [],
  cancelled: [],
  expired: [],
};

export function canTransitionReservationStatus(
  current: ReservationStatus,
  next: ReservationStatus,
): boolean {
  return reservationStatusTransitions[current].includes(next);
}

export function deriveOperationalStatus(
  reservation: {
    reservationStatus: ReservationStatus;
    checkInDate: string;
    checkOutDate: string;
  },
  today: string,
): OperationalStatus {
  switch (reservation.reservationStatus) {
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "checked_out":
      return "checked_out";
    case "checked_in":
      return reservation.checkOutDate < today
        ? "overdue"
        : reservation.checkOutDate === today
          ? "due_out"
          : "in_house";
    case "confirmed":
      return reservation.checkInDate > today ? "upcoming" : "ready_to_check_in";
    case "pending":
      return "awaiting_confirmation";
  }
}

export function getCheckInWarning(
  reservationStatus: ReservationStatus,
  paymentStatus: ReservationPaymentStatus,
): "none" | "outstanding" | "unpaid" | "not_allowed" {
  if (reservationStatus !== "confirmed") return "not_allowed";
  if (paymentStatus === "paid") return "none";
  if (paymentStatus === "partial") return "outstanding";
  if (paymentStatus === "unpaid") return "unpaid";
  return "not_allowed";
}

export function getCheckOutWarning(
  reservationStatus: ReservationStatus,
  remainingBalance: number,
): "none" | "outstanding" | "not_allowed" {
  if (reservationStatus !== "checked_in") return "not_allowed";
  return remainingBalance > 0 ? "outstanding" : "none";
}
