import { eq } from "drizzle-orm";
import type { AppConfig } from "../../../config/env.js";
import { guests } from "../../../db/schema/guests.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { renderPublicReservationDocument } from "../../reservations/services/public-reservation-document.service.js";
import { getPublicReservationPaymentStatus } from "../../reservations/services/public-reservation-payment-status.service.js";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]!,
  );

const date = (value: string) =>
  new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));

export async function buildReservationVoucherEmail(
  db: Database,
  config: NonNullable<AppConfig["email"]>,
  reservationId: string,
) {
  const [status, [reservation]] = await Promise.all([
    getPublicReservationPaymentStatus(db, reservationId),
    db
      .select({
        bookingCode: reservations.bookingCode,
        source: reservations.source,
        reservationStatus: reservations.reservationStatus,
        paymentStatus: reservations.paymentStatus,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
        guestName: guests.fullName,
        guestEmail: guests.email,
      })
      .from(reservations)
      .innerJoin(guests, eq(reservations.guestId, guests.id))
      .where(eq(reservations.id, reservationId))
      .limit(1),
  ]);

  if (
    !status ||
    !reservation ||
    reservation.source !== "website" ||
    reservation.reservationStatus !== "confirmed" ||
    reservation.paymentStatus !== "paid" ||
    !reservation.guestEmail
  ) {
    throw new Error("Reservation is not eligible for a voucher email");
  }

  const voucher = await renderPublicReservationDocument(db, reservationId, "voucher", status);
  if (!voucher) throw new Error("Reservation voucher could not be generated");

  const guestName = escapeHtml(reservation.guestName);
  const bookingCode = escapeHtml(reservation.bookingCode);
  const fromName = escapeHtml(config.fromName);
  return {
    recipient: reservation.guestEmail,
    subject: `E-Voucher Reservasi ${reservation.bookingCode} - ${config.fromName}`,
    text: [
      `Halo ${reservation.guestName},`,
      "",
      "Pembayaran reservasi Anda telah berhasil dan reservasi sudah dikonfirmasi.",
      `Kode booking: ${reservation.bookingCode}`,
      `Check-in: ${date(reservation.checkInDate)}`,
      `Check-out: ${date(reservation.checkOutDate)}`,
      "",
      "E-voucher terlampir pada email ini. Tunjukkan voucher tersebut saat check-in.",
      "",
      config.fromName,
    ].join("\n"),
    html: `<!doctype html><html><body style="margin:0;background:#f3f6f3;font-family:Arial,sans-serif;color:#18382b"><div style="max-width:640px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border:1px solid #dfe7e1;border-radius:14px;padding:30px"><p style="margin:0 0 18px;color:#5e7268">${fromName}</p><h1 style="margin:0 0 18px;font-size:24px">Reservasi Anda telah dikonfirmasi</h1><p>Halo ${guestName},</p><p>Pembayaran reservasi Anda telah berhasil. E-voucher terlampir pada email ini.</p><div style="margin:24px 0;padding:18px;background:#f2f7f3;border-radius:10px"><strong>Kode booking: ${bookingCode}</strong><br><span>Check-in: ${date(reservation.checkInDate)}</span><br><span>Check-out: ${date(reservation.checkOutDate)}</span></div><p>Tunjukkan e-voucher kepada petugas saat check-in.</p><p style="margin:26px 0 0;color:#65776e;font-size:13px">Email ini dikirim otomatis. Jika membutuhkan bantuan, balas email ini untuk menghubungi tim reservasi.</p></div></div></body></html>`,
    attachment: {
      filename: `${reservation.bookingCode}-voucher.pdf`,
      content: voucher,
      contentType: "application/pdf",
    },
  };
}
