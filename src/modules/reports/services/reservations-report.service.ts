import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { guests } from "../../../db/schema/guests.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { paymentRefunds } from "../../../db/schema/payment_refunds.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservationCharges } from "../../../db/schema/reservation_charges.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import type {
  ReservationPaymentStatus,
  ReservationStatus,
} from "../../reservations/reservation-status.js";
import type { Database } from "../../../plugins/database.js";

export type ReservationReportSource = "website" | "phone" | "walk_in" | "ota";
export type ReservationReportDateBy = "booking" | "check_in" | "check_out";
export type ReservationReportSort = "newest" | "booking_code_asc" | "booking_code_desc";

export type ReservationReportFilters = {
  search?: string;
  dateBy: ReservationReportDateBy;
  from?: string;
  to?: string;
  reservationStatus?: ReservationStatus;
  source?: ReservationReportSource;
  roomType?: string;
  otaChannelId?: string;
  sort: ReservationReportSort;
};

export type ReservationReportRow = {
  id: string;
  bookingCode: string;
  bookingDate: string;
  guest: { fullName: string; phone: string | null };
  source: ReservationReportSource;
  otaChannel: { id: string; name: string } | null;
  roomTypes: string[];
  roomQuantity: number;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  roomNights: number;
  reservationStatus: ReservationStatus;
  paymentStatus: ReservationPaymentStatus;
  bookingTotal: number;
  discount: number;
  paid: number;
  outstanding: number;
};

export type ReservationReportSummary = {
  totalReservations: number;
  pending: number;
  confirmed: number;
  checkedIn: number;
  checkedOut: number;
  cancelled: number;
  expired: number;
  roomNights: number;
};

export type ReservationReportFinancial = {
  bookingValue: number;
  paid: number;
  outstanding: number;
};

export type ReservationReportResult = {
  items: ReservationReportRow[];
  summary: ReservationReportSummary;
  financial: ReservationReportFinancial;
  page: number;
  limit: number;
  total: number;
};

// Statuses excluded from the financial snapshot (mirrors the admin report page:
// cancelled and expired reservations do not contribute booking value or outstanding).
const inactiveStatuses: ReservationStatus[] = ["cancelled", "expired"];

function dateColumn(dateBy: ReservationReportDateBy) {
  if (dateBy === "check_in") return sql`${reservations.checkInDate}`;
  if (dateBy === "check_out") return sql`${reservations.checkOutDate}`;
  // "booking" filters on the calendar date of createdAt (Asia/Jakarta).
  return sql`(${reservations.createdAt} at time zone 'Asia/Jakarta')::date`;
}

export async function getReservationsReport(
  db: Database,
  filters: ReservationReportFilters,
  pagination: { page: number; limit: number },
): Promise<ReservationReportResult> {
  const { page, limit } = pagination;
  const term = filters.search?.trim();
  const rangeColumn = dateColumn(filters.dateBy);

  const whereClause = and(
    term
      ? or(
          ilike(reservations.bookingCode, `%${term}%`),
          ilike(guests.fullName, `%${term}%`),
          ilike(guests.phone, `%${term}%`),
          ilike(reservations.externalReference, `%${term}%`),
        )
      : undefined,
    filters.from ? sql`${rangeColumn} >= ${filters.from}` : undefined,
    filters.to ? sql`${rangeColumn} <= ${filters.to}` : undefined,
    filters.reservationStatus
      ? eq(reservations.reservationStatus, filters.reservationStatus)
      : undefined,
    filters.source ? eq(reservations.source, filters.source) : undefined,
    filters.otaChannelId ? eq(reservations.otaChannelId, filters.otaChannelId) : undefined,
    filters.roomType
      ? sql`exists (select 1 from ${reservationRooms} rr where rr.reservation_id = ${reservations.id} and rr.room_type_id = ${filters.roomType})`
      : undefined,
  );

  const ordering =
    filters.sort === "booking_code_asc"
      ? [asc(reservations.bookingCode), desc(reservations.id)]
      : filters.sort === "booking_code_desc"
        ? [desc(reservations.bookingCode), desc(reservations.id)]
        : [desc(reservations.createdAt), desc(reservations.id)];

  const [pageRows, [countRow]] = await Promise.all([
    db
      .select({
        id: reservations.id,
        bookingCode: reservations.bookingCode,
        bookingDate: sql<string>`(${reservations.createdAt} at time zone 'Asia/Jakarta')::date`,
        source: reservations.source,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
        nights: sql<number>`(${reservations.checkOutDate} - ${reservations.checkInDate})`.mapWith(
          Number,
        ),
        reservationStatus: reservations.reservationStatus,
        paymentStatus: reservations.paymentStatus,
        guestFullName: guests.fullName,
        guestPhone: guests.phone,
        otaChannelId: masterItems.id,
        otaChannelName: masterItems.name,
      })
      .from(reservations)
      .innerJoin(guests, eq(reservations.guestId, guests.id))
      .leftJoin(masterItems, eq(reservations.otaChannelId, masterItems.id))
      .where(whereClause)
      .orderBy(...ordering)
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ total: sql<number>`count(*)::int`.mapWith(Number) })
      .from(reservations)
      .innerJoin(guests, eq(reservations.guestId, guests.id))
      .where(whereClause),
  ]);

  // Summary and financial aggregates span the entire filtered set, not just the page.
  const [summaryRow] = await db
    .select({
      totalReservations: sql<number>`count(*)::int`.mapWith(Number),
      pending:
        sql<number>`count(*) filter (where ${reservations.reservationStatus} = 'pending')::int`.mapWith(
          Number,
        ),
      confirmed:
        sql<number>`count(*) filter (where ${reservations.reservationStatus} = 'confirmed')::int`.mapWith(
          Number,
        ),
      checkedIn:
        sql<number>`count(*) filter (where ${reservations.reservationStatus} = 'checked_in')::int`.mapWith(
          Number,
        ),
      checkedOut:
        sql<number>`count(*) filter (where ${reservations.reservationStatus} = 'checked_out')::int`.mapWith(
          Number,
        ),
      cancelled:
        sql<number>`count(*) filter (where ${reservations.reservationStatus} = 'cancelled')::int`.mapWith(
          Number,
        ),
      expired:
        sql<number>`count(*) filter (where ${reservations.reservationStatus} = 'expired')::int`.mapWith(
          Number,
        ),
    })
    .from(reservations)
    .innerJoin(guests, eq(reservations.guestId, guests.id))
    .where(whereClause);

  const ids = pageRows.map((row) => row.id);

  const [roomRows, chargeTotals, paymentTotals, refundTotals, roomNightsRow] = await Promise.all([
    ids.length
      ? db
          .select({
            reservationId: reservationRooms.reservationId,
            roomTypeName: reservationRooms.roomTypeNameSnapshot,
          })
          .from(reservationRooms)
          .where(inArray(reservationRooms.reservationId, ids))
          .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id))
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            reservationId: reservationCharges.reservationId,
            amount: sql<number>`coalesce(sum(${reservationCharges.amount}), 0)::bigint`.mapWith(
              Number,
            ),
          })
          .from(reservationCharges)
          .where(inArray(reservationCharges.reservationId, ids))
          .groupBy(reservationCharges.reservationId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            reservationId: payments.reservationId,
            amount: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number),
          })
          .from(payments)
          .where(
            and(
              inArray(payments.reservationId, ids),
              inArray(payments.status, ["succeeded", "partially_refunded", "refunded"]),
            ),
          )
          .groupBy(payments.reservationId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            reservationId: payments.reservationId,
            amount: sql<number>`coalesce(sum(${paymentRefunds.amount}), 0)::bigint`.mapWith(Number),
          })
          .from(paymentRefunds)
          .innerJoin(payments, eq(paymentRefunds.paymentId, payments.id))
          .where(and(inArray(payments.reservationId, ids), eq(paymentRefunds.status, "succeeded")))
          .groupBy(payments.reservationId)
      : Promise.resolve([]),
    // Room nights across the whole filtered set: sum of (nights * room count) per reservation.
    db
      .select({
        roomNights:
          sql<number>`coalesce(sum((${reservations.checkOutDate} - ${reservations.checkInDate}) * rc.room_count), 0)::bigint`.mapWith(
            Number,
          ),
      })
      .from(reservations)
      .innerJoin(guests, eq(reservations.guestId, guests.id))
      .innerJoin(
        sql`(select reservation_id, count(*)::int as room_count from ${reservationRooms} group by reservation_id) as rc`,
        sql`rc.reservation_id = ${reservations.id}`,
      )
      .where(whereClause),
  ]);

  const roomTypesByReservation = new Map<string, string[]>();
  const roomCountByReservation = new Map<string, number>();
  for (const room of roomRows) {
    const names = roomTypesByReservation.get(room.reservationId) ?? [];
    names.push(room.roomTypeName);
    roomTypesByReservation.set(room.reservationId, names);
    roomCountByReservation.set(
      room.reservationId,
      (roomCountByReservation.get(room.reservationId) ?? 0) + 1,
    );
  }
  const chargesById = new Map(chargeTotals.map((row) => [row.reservationId, row.amount]));
  const paymentsById = new Map(paymentTotals.map((row) => [row.reservationId, row.amount]));
  const refundsById = new Map(refundTotals.map((row) => [row.reservationId, row.amount]));

  const items: ReservationReportRow[] = pageRows.map((row) => {
    const roomQuantity = Math.max(1, roomCountByReservation.get(row.id) ?? 0);
    const nights = Math.max(1, row.nights);
    const bookingTotal = chargesById.get(row.id) ?? 0;
    const netPaid = Math.max(0, (paymentsById.get(row.id) ?? 0) - (refundsById.get(row.id) ?? 0));
    const isInactive = inactiveStatuses.includes(row.reservationStatus);
    const paid = isInactive ? 0 : netPaid;
    const outstanding = isInactive ? 0 : Math.max(0, bookingTotal - netPaid);

    return {
      id: row.id,
      bookingCode: row.bookingCode,
      bookingDate: row.bookingDate,
      guest: { fullName: row.guestFullName, phone: row.guestPhone },
      source: row.source as ReservationReportSource,
      otaChannel: row.otaChannelId
        ? { id: row.otaChannelId, name: row.otaChannelName ?? "" }
        : null,
      roomTypes: roomTypesByReservation.get(row.id) ?? [],
      roomQuantity,
      checkInDate: row.checkInDate,
      checkOutDate: row.checkOutDate,
      nights,
      roomNights: nights * roomQuantity,
      reservationStatus: row.reservationStatus,
      paymentStatus: row.paymentStatus,
      bookingTotal,
      // No discount is persisted in the data model; kept for a stable report contract.
      discount: 0,
      paid,
      outstanding,
    };
  });

  const financial = await computeFinancialSnapshot(db, whereClause);

  const summary: ReservationReportSummary = {
    totalReservations: summaryRow?.totalReservations ?? 0,
    pending: summaryRow?.pending ?? 0,
    confirmed: summaryRow?.confirmed ?? 0,
    checkedIn: summaryRow?.checkedIn ?? 0,
    checkedOut: summaryRow?.checkedOut ?? 0,
    cancelled: summaryRow?.cancelled ?? 0,
    expired: summaryRow?.expired ?? 0,
    roomNights: roomNightsRow[0]?.roomNights ?? 0,
  };

  return {
    items,
    summary,
    financial,
    page,
    limit,
    total: countRow?.total ?? 0,
  };
}

// Financial snapshot covers only active reservations (not cancelled/expired) across the
// whole filtered set, matching the admin report page. Booking value is the sum of charges;
// paid is net of succeeded refunds; outstanding is max(0, bookingValue - paid).
async function computeFinancialSnapshot(
  db: Database,
  whereClause: ReturnType<typeof and>,
): Promise<ReservationReportFinancial> {
  const activeIdsRows = await db
    .select({ id: reservations.id })
    .from(reservations)
    .innerJoin(guests, eq(reservations.guestId, guests.id))
    .where(
      and(
        whereClause,
        inArray(reservations.reservationStatus, [
          "pending",
          "confirmed",
          "checked_in",
          "checked_out",
        ]),
      ),
    );

  const activeIds = activeIdsRows.map((row) => row.id);
  if (activeIds.length === 0) {
    return { bookingValue: 0, paid: 0, outstanding: 0 };
  }

  const [[chargeRow], paymentRows, refundRows] = await Promise.all([
    db
      .select({
        amount: sql<number>`coalesce(sum(${reservationCharges.amount}), 0)::bigint`.mapWith(Number),
      })
      .from(reservationCharges)
      .where(inArray(reservationCharges.reservationId, activeIds)),
    db
      .select({
        reservationId: payments.reservationId,
        amount: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number),
      })
      .from(payments)
      .where(
        and(
          inArray(payments.reservationId, activeIds),
          inArray(payments.status, ["succeeded", "partially_refunded", "refunded"]),
        ),
      )
      .groupBy(payments.reservationId),
    db
      .select({
        reservationId: payments.reservationId,
        amount: sql<number>`coalesce(sum(${paymentRefunds.amount}), 0)::bigint`.mapWith(Number),
      })
      .from(paymentRefunds)
      .innerJoin(payments, eq(paymentRefunds.paymentId, payments.id))
      .where(
        and(inArray(payments.reservationId, activeIds), eq(paymentRefunds.status, "succeeded")),
      )
      .groupBy(payments.reservationId),
  ]);

  const paymentsById = new Map(paymentRows.map((row) => [row.reservationId, row.amount]));
  const refundsById = new Map(refundRows.map((row) => [row.reservationId, row.amount]));

  const bookingValue = chargeRow?.amount ?? 0;
  let paid = 0;
  for (const id of activeIds) {
    paid += Math.max(0, (paymentsById.get(id) ?? 0) - (refundsById.get(id) ?? 0));
  }
  const outstanding = Math.max(0, bookingValue - paid);

  return { bookingValue, paid, outstanding };
}
