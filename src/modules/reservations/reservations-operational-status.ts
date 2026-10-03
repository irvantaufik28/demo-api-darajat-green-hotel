import type { reservations } from "../../db/schema/reservations.schema.js";

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
  today: string,
): ReservationOperationalStatus {
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
    if (checkOutDate > today) {
      return {
        code: "in_house",
        label: "In House",
        description: "Tamu sedang menginap dan belum masuk hari checkout.",
      };
    }
    if (checkOutDate === today) {
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
    return {
      code: "overdue",
      label: `Overdue - ${daysOverdue} ${daysOverdue === 1 ? "Day" : "Days"}`,
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
