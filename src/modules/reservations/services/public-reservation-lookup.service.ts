import { and, asc, desc, eq, ilike, inArray } from "drizzle-orm";
import { guests } from "../../../db/schema/guests.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { reservationExperiences } from "../../../db/schema/reservation_experiences.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomTypeImages } from "../../../db/schema/room_type_images.schema.js";
import type { Database } from "../../../plugins/database.js";
import { readReservationFinancials } from "./reservation-financials.service.js";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("62")) return `0${digits.slice(2)}`;
  return digits;
}

function matchesContact(contactInfo: string, email: string | null, phone: string | null) {
  const input = contactInfo.trim();
  if (input.includes("@")) return Boolean(email && normalizeEmail(input) === normalizeEmail(email));
  const normalized = normalizePhone(input);
  return normalized.length >= 6 && Boolean(phone && normalized === normalizePhone(phone));
}

export async function findPublicReservationByContact(
  db: Database,
  bookingCode: string,
  contactInfo: string,
) {
  const [record] = await db
    .select({ reservation: reservations, guest: guests })
    .from(reservations)
    .innerJoin(guests, eq(reservations.guestId, guests.id))
    .where(
      and(ilike(reservations.bookingCode, bookingCode.trim()), eq(reservations.source, "website")),
    )
    .limit(1);

  return record && matchesContact(contactInfo, record.guest.email, record.guest.phone)
    ? record
    : null;
}

export async function lookupPublicReservation(
  db: Database,
  bookingCode: string,
  contactInfo: string,
) {
  const record = await findPublicReservationByContact(db, bookingCode, contactInfo);
  if (!record) return null;

  const reservationId = record.reservation.id;
  const [rooms, experiences, financials] = await Promise.all([
    db
      .select({
        id: reservationRooms.id,
        roomTypeId: reservationRooms.roomTypeId,
        name: reservationRooms.roomTypeNameSnapshot,
        adults: reservationRooms.adults,
        children: reservationRooms.children,
        bedConfiguration: reservationRooms.bedConfigurationSnapshot,
      })
      .from(reservationRooms)
      .where(eq(reservationRooms.reservationId, reservationId))
      .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id)),
    db
      .select({
        name: reservationExperiences.nameSnapshot,
        description: reservationExperiences.descriptionSnapshot,
        quantity: reservationExperiences.quantity,
        unitPrice: reservationExperiences.unitPrice,
        serviceDate: reservationExperiences.serviceDate,
      })
      .from(reservationExperiences)
      .where(eq(reservationExperiences.reservationId, reservationId))
      .orderBy(asc(reservationExperiences.createdAt), asc(reservationExperiences.id)),
    readReservationFinancials(db, reservationId),
  ]);

  const images = rooms.length
    ? await db
        .select({
          roomTypeId: roomTypeImages.roomTypeId,
          url: roomTypeImages.url,
          altText: roomTypeImages.altText,
          isCover: roomTypeImages.isCover,
          sortOrder: roomTypeImages.sortOrder,
        })
        .from(roomTypeImages)
        .where(
          inArray(
            roomTypeImages.roomTypeId,
            rooms.map((room) => room.roomTypeId),
          ),
        )
        .orderBy(desc(roomTypeImages.isCover), asc(roomTypeImages.sortOrder))
    : [];

  const latestPayment = financials.payments
    .filter((payment) => ["succeeded", "partially_refunded", "refunded"].includes(payment.status))
    .sort((left, right) => (right.paidAt?.getTime() ?? 0) - (left.paidAt?.getTime() ?? 0))[0];
  const [paymentMethod] = latestPayment
    ? await db
        .select({ name: masterItems.name })
        .from(masterItems)
        .where(eq(masterItems.id, latestPayment.methodId))
        .limit(1)
    : [];
  const hasCompletedPayment = financials.netPaidAmount > 0;
  const voucherAvailable =
    hasCompletedPayment &&
    ["confirmed", "checked_in", "checked_out"].includes(record.reservation.reservationStatus);

  return {
    reservation: {
      bookingCode: record.reservation.bookingCode,
      guestName: record.guest.fullName,
      checkInDate: record.reservation.checkInDate,
      checkOutDate: record.reservation.checkOutDate,
      adults: record.reservation.adults,
      children: record.reservation.children,
      reservationStatus: record.reservation.reservationStatus,
      paymentStatus: record.reservation.paymentStatus,
      createdAt: record.reservation.createdAt.toISOString(),
      confirmedAt: record.reservation.confirmedAt?.toISOString() ?? null,
      checkedInAt: record.reservation.checkedInAt?.toISOString() ?? null,
      checkedOutAt: record.reservation.checkedOutAt?.toISOString() ?? null,
      rooms: rooms.map((room) => ({
        name: room.name,
        adults: room.adults,
        children: room.children,
        bedConfiguration: room.bedConfiguration,
        image: images.find((image) => image.roomTypeId === room.roomTypeId) ?? null,
      })),
      experiences,
      payment: {
        bookingTotal: financials.bookingTotal,
        paidAmount: financials.netPaidAmount,
        remainingBalance: financials.remainingBalance,
        currency: "IDR" as const,
        latestTransaction: latestPayment
          ? {
              method: paymentMethod?.name ?? null,
              provider: latestPayment.provider,
              reference: latestPayment.providerReference,
              paidAt: latestPayment.paidAt?.toISOString() ?? null,
              amount: latestPayment.amount,
            }
          : null,
      },
      documents: {
        voucherAvailable,
        receiptAvailable: hasCompletedPayment,
      },
    },
    total: financials.bookingTotal,
  };
}
