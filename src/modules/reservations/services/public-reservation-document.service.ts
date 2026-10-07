import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { guests } from "../../../db/schema/guests.schema.js";
import { hotelInfo } from "../../../db/schema/hotel_info.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import type { getPublicReservationPaymentStatus } from "./public-reservation-payment-status.service.js";

type PaymentStatus = NonNullable<Awaited<ReturnType<typeof getPublicReservationPaymentStatus>>>;
type DocumentType = "voucher" | "receipt";

const money = (amount: number) => `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
const date = (value: string) =>
  new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
const dateTime = (value: string) =>
  `${new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeStyle: "short", timeZone: "Asia/Jakarta" }).format(new Date(value))} WIB`;

// Standard PDF fonts use WinAnsi. Replace unsupported characters so user data cannot break the download.
function pdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

export async function renderPublicReservationDocument(
  db: Database,
  reservationId: string,
  type: DocumentType,
  status: PaymentStatus,
) {
  const [[reservation], [hotel]] = await Promise.all([
    db
      .select({
        guestName: guests.fullName,
        guestEmail: guests.email,
        guestPhone: guests.phone,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
      })
      .from(reservations)
      .innerJoin(guests, eq(reservations.guestId, guests.id))
      .where(eq(reservations.id, reservationId))
      .limit(1),
    db
      .select({
        name: hotelInfo.name,
        address: hotelInfo.address,
        phone: hotelInfo.phone,
        email: hotelInfo.email,
      })
      .from(hotelInfo)
      .where(eq(hotelInfo.id, 1))
      .limit(1),
  ]);
  if (!reservation) return null;

  const document = await PDFDocument.create();
  document.setTitle(
    `${type === "voucher" ? "E-Voucher" : "Bukti Pembayaran"} ${status.bookingCode}`,
  );
  document.setAuthor(hotel?.name ?? "Green Hero Darajat");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page = document.addPage([595.28, 841.89]);
  let y = 790;
  const left = 48;
  const maxWidth = 499;

  function write(value: string, size = 10, weight: "regular" | "bold" = "regular", gap = 5) {
    const font = weight === "bold" ? bold : regular;
    const words = pdfText(value).split(/\s+/);
    let line = "";
    const lines: string[] = [];
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    for (const text of lines) {
      if (y < 62) {
        page = document.addPage([595.28, 841.89]);
        y = 790;
      }
      page.drawText(text, { x: left, y, size, font, color: rgb(0.08, 0.19, 0.16) });
      y -= size + gap;
    }
  }

  function section(heading: string) {
    y -= 12;
    write(heading, 12, "bold", 7);
    page.drawLine({
      start: { x: left, y },
      end: { x: left + maxWidth, y },
      thickness: 0.8,
      color: rgb(0.82, 0.86, 0.81),
    });
    y -= 15;
  }

  write(hotel?.name ?? "Green Hero Darajat", 18, "bold", 9);
  if (hotel?.address) write(hotel.address, 9);
  if (hotel?.phone || hotel?.email)
    write([hotel.phone, hotel.email].filter(Boolean).join(" | "), 9);
  y -= 22;
  write(type === "voucher" ? "E-VOUCHER RESERVASI" : "BUKTI PEMBAYARAN", 19, "bold", 8);
  write(`Kode booking: ${status.bookingCode}`, 11, "bold");
  write(`Nama tamu: ${reservation.guestName}`);
  if (reservation.guestEmail) write(`Email: ${reservation.guestEmail}`);
  if (reservation.guestPhone) write(`Telepon: ${reservation.guestPhone}`);

  if (type === "voucher") {
    section("Detail Menginap");
    write(`Check-in: ${date(reservation.checkInDate)}`);
    write(`Check-out: ${date(reservation.checkOutDate)}`);
    for (const room of status.summary.rooms) write(`${room.name} - ${room.nights} malam`);
    if (status.summary.extras.length) {
      section("Pilihan Tambahan");
      for (const extra of status.summary.extras)
        write(`${extra.description} - ${money(extra.amount)}`);
    }
  } else {
    section("Transaksi");
    const payment = status.summary.payment;
    if (payment?.paidAt) write(`Waktu pembayaran: ${dateTime(payment.paidAt)}`);
    if (payment?.provider) write(`Penyedia pembayaran: ${payment.provider}`);
    if (payment?.reference) write(`Referensi transaksi: ${payment.reference}`);
    if (payment) write(`Nominal transaksi: ${money(payment.amount)}`, 11, "bold");
  }

  section("Ringkasan Pembayaran");
  for (const room of status.summary.rooms) {
    write(`${room.name} (${room.nights} malam): ${money(room.baseAmount)}`);
    if (room.discountAmount > 0) write(`Diskon kamar: -${money(room.discountAmount)}`);
  }
  for (const extra of status.summary.extras) write(`${extra.description}: ${money(extra.amount)}`);
  write(`Total reservasi: ${money(status.bookingTotal)}`, 11, "bold");
  write(`Total sudah dibayar: ${money(status.paidAmount)}`);
  write(`Sisa tagihan: ${money(status.remainingBalance)}`);
  y -= 15;
  write(
    type === "voucher"
      ? "Tunjukkan e-voucher ini kepada petugas saat check-in."
      : "Bukti ini dibuat dari pembayaran yang tercatat pada sistem reservasi hotel.",
    9,
  );

  return Buffer.from(await document.save());
}
