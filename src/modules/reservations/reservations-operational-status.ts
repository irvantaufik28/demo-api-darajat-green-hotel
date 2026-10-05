import type { reservations } from "../../db/schema/reservations.schema.js";
import { deriveCheckedInOperationalStatus } from "./reservation-status.js";
import type { CheckOutClock } from "./services/reservation-check-out-time.service.js";

type ReservationStatus = (typeof reservations.$inferSelect)["reservationStatus"];

export type ReservationOperationalStatus = {
  code: string;
  label: string;
  description: string;
  daysOverdue?: number;
} | null;

export function resolveReservationOperationalStatus(
  reservationStatus: ReservationStatus,
  checkInDate: string,
  checkOutDate: string,
  clock: CheckOutClock,
): ReservationOperationalStatus {
  const today = clock.serverDate;
  if (reservationStatus === "pending") {
    return {
      code: "awaiting_confirmation",
      label: "Awaiting Confirmation",
      description: "Booking belum dikonfirmasi.",
    };
  }

  if (reservationStatus === "confirmed") {
    if (checkInDate > today) {
      return { code: "upcoming", label: "Upcoming", description: "Reservasi mendatang." };
    }
    if (checkInDate === today) {
      return {
        code: "ready_to_check_in",
        label: "Ready to Check-in",
        description: "Tamu dijadwalkan check-in hari ini.",
      };
    }
    return null;
  }

  if (reservationStatus === "checked_in") {
    const status = deriveCheckedInOperationalStatus(checkOutDate, clock);
    if (status === "in_house") {
      return {
        code: "in_house",
        label: "In House",
        description: "Tamu sedang menginap dan belum masuk hari checkout.",
      };
    }
    if (status === "due_out") {
      return {
        code: "due_out",
        label: "Due Out",
        description: "Tamu dijadwalkan checkout hari ini.",
      };
    }

    const daysOverdue = Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${checkOutDate}T00:00:00Z`)) /
        86_400_000,
    );
    const minutes = clock.minutesPastCheckOutTime;
    const sameDayLabel = minutes < 1
      ? "Overdue · <1m"
      : `Overdue · ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    return {
      code: "overdue",
      label: daysOverdue === 0
        ? sameDayLabel
        : `Overdue - ${daysOverdue} ${daysOverdue === 1 ? "Day" : "Days"}`,
      description: "Tamu masih checked-in setelah melewati jadwal checkout.",
      daysOverdue,
    };
  }

  if (reservationStatus === "checked_out") {
    return { code: "checked_out", label: "Checked Out", description: "Stay telah selesai." };
  }
  if (reservationStatus === "cancelled") {
    return { code: "cancelled", label: "Cancelled", description: "Booking dibatalkan." };
  }
  return { code: "expired", label: "Expired", description: "Booking kedaluwarsa." };
}
