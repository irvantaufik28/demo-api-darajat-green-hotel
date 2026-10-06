import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
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

export type RevenueReportSource = "website" | "phone" | "walk_in" | "ota";
export type RevenueReportDateBy = "payment" | "booking" | "check_in";

export type RevenueReportFilters = {
  dateBy: RevenueReportDateBy;
  from?: string;
  to?: string;
  source?: RevenueReportSource;
  paymentStatus?: ReservationPaymentStatus;
  reservationStatus?: ReservationStatus;
  methodId?: string;
  roomType?: string;
};

export type RevenueTotals = {
  reservations: number;
  transactions: number;
  gross: number;
  discount: number;
  net: number;
  paid: number;
  refunded: number;
  outstanding: number;
  netCollected: number;
};

export type RevenueBySource = {
  source: RevenueReportSource;
  reservations: number;
  gross: number;
  paid: number;
  refunded: number;
  outstanding: number;
  netCollected: number;
};

export type RevenueByMethod = {
  methodId: string;
  methodName: string;
  transactions: number;
  paid: number;
  refunded: number;
  netCollected: number;
};

export type RevenueReportRow = {
  id: string;
  bookingCode: string;
  guest: { fullName: string; phone: string | null };
  source: RevenueReportSource;
  reservationStatus: ReservationStatus;
  paymentStatus: ReservationPaymentStatus;
  methodNames: string[];
  bookingDate: string;
  paymentDate: string | null;
  checkInDate: string;
  roomTypes: string[];
  gross: number;
  discount: number;
  net: number;
  paid: number;
  refunded: number;
  outstanding: number;
  netCollected: number;
};

export type RevenueReportResult = {
  totals: RevenueTotals;
  bySource: RevenueBySource[];
  byMethod: RevenueByMethod[];
  items: RevenueReportRow[];
};

const allSources: RevenueReportSource[] = ["website", "phone", "walk_in", "ota"];
const inactiveStatuses: ReservationStatus[] = ["cancelled", "expired"];
const paidPaymentStatuses = ["succeeded", "partially_refunded", "refunded"] as const;

export async function getRevenueReport(
  db: Database,
  filters: RevenueReportFilters,
): Promise<RevenueReportResult> {
  const { dateBy, from, to } = filters;

  // Reservation-level filters shared by every date mode.
  const reservationFilters = and(
    filters.source ? eq(reservations.source, filters.source) : undefined,
    filters.paymentStatus ? eq(reservations.paymentStatus, filters.paymentStatus) : undefined,
    filters.reservationStatus
      ? eq(reservations.reservationStatus, filters.reservationStatus)
      : undefined,
    filters.roomType
      ? sql`exists (select 1 from ${reservationRooms} rr where rr.reservation_id = ${reservations.id} and rr.room_type_id = ${filters.roomType})`
      : undefined,
    filters.methodId
      ? sql`exists (
          select 1 from ${payments} p
          where p.reservation_id = ${reservations.id}
            and p.method_id = ${filters.methodId}
            and p.status in ('succeeded', 'partially_refunded', 'refunded')
        )`
      : undefined,
  );

  // Date filter depends on the selected mode. For "payment", a reservation qualifies when it
  // has at least one succeeded payment paid within the range.
  const dateFilter =
    dateBy === "booking"
      ? and(
          from
            ? sql`(${reservations.createdAt} at time zone 'Asia/Jakarta')::date >= ${from}::date`
            : undefined,
          to
            ? sql`(${reservations.createdAt} at time zone 'Asia/Jakarta')::date <= ${to}::date`
            : undefined,
        )
      : dateBy === "check_in"
        ? and(
            from ? sql`${reservations.checkInDate} >= ${from}::date` : undefined,
            to ? sql`${reservations.checkInDate} <= ${to}::date` : undefined,
          )
        : from || to
          ? sql`exists (
              select 1 from ${payments} p
              where p.reservation_id = ${reservations.id}
                and p.status in ('succeeded', 'partially_refunded', 'refunded')
                and ${paymentDateInRangeFor(sql`p`, from, to)}
            )`
          : undefined;

  const whereClause = and(reservationFilters, dateFilter);

  // Resolve the reservation set once, then compute financials per reservation.
  const reservationRows = await db
    .select({
      id: reservations.id,
      bookingCode: reservations.bookingCode,
      source: reservations.source,
      reservationStatus: reservations.reservationStatus,
      paymentStatus: reservations.paymentStatus,
      checkInDate: reservations.checkInDate,
      bookingDate: sql<string>`(${reservations.createdAt} at time zone 'Asia/Jakarta')::date`,
      guestFullName: guests.fullName,
      guestPhone: guests.phone,
    })
    .from(reservations)
    .innerJoin(guests, eq(reservations.guestId, guests.id))
    .where(whereClause);

  const ids = reservationRows.map((row) => row.id);
  if (ids.length === 0) {
    return {
      totals: emptyTotals(),
      bySource: allSources.map(emptyBySource),
      byMethod: [],
      items: [],
    };
  }

  const [chargeRows, paymentRows, refundRows, roomRows, methodRows] = await Promise.all([
    db
      .select({
        reservationId: reservationCharges.reservationId,
        amount: sql<number>`coalesce(sum(${reservationCharges.amount}), 0)::bigint`.mapWith(Number),
      })
      .from(reservationCharges)
      .where(inArray(reservationCharges.reservationId, ids))
      .groupBy(reservationCharges.reservationId),
    db
      .select({
        reservationId: payments.reservationId,
        amount: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number),
        paidAt: sql<
          string | null
        >`max((coalesce(${payments.paidAt}, ${payments.createdAt}) at time zone 'Asia/Jakarta')::date)`,
      })
      .from(payments)
      .where(
        and(inArray(payments.reservationId, ids), inArray(payments.status, paidPaymentStatuses)),
      )
      .groupBy(payments.reservationId),
    db
      .select({
        reservationId: payments.reservationId,
        amount: sql<number>`coalesce(sum(${paymentRefunds.amount}), 0)::bigint`.mapWith(Number),
      })
      .from(paymentRefunds)
      .innerJoin(payments, eq(paymentRefunds.paymentId, payments.id))
      .where(and(inArray(payments.reservationId, ids), eq(paymentRefunds.status, "succeeded")))
      .groupBy(payments.reservationId),
    db
      .select({
        reservationId: reservationRooms.reservationId,
        roomTypeName: reservationRooms.roomTypeNameSnapshot,
      })
      .from(reservationRooms)
      .where(inArray(reservationRooms.reservationId, ids)),
    // Per-method aggregation at the payment level: paid is net of succeeded refunds per payment.
    db
      .select({
        reservationId: payments.reservationId,
        methodId: masterItems.id,
        methodName: masterItems.name,
        amount: payments.amount,
        refunded: sql<number>`coalesce((
          select sum(r.amount) from ${paymentRefunds} r
          where r.payment_id = ${payments.id} and r.status = 'succeeded'
        ), 0)::bigint`.mapWith(Number),
      })
      .from(payments)
      .innerJoin(masterItems, eq(payments.methodId, masterItems.id))
      .where(
        and(inArray(payments.reservationId, ids), inArray(payments.status, paidPaymentStatuses)),
      ),
  ]);

  const grossById = new Map(chargeRows.map((row) => [row.reservationId, row.amount]));
  const grossPaidById = new Map(paymentRows.map((row) => [row.reservationId, row.amount]));
  const paidAtById = new Map(paymentRows.map((row) => [row.reservationId, row.paidAt]));
  const refundedById = new Map(refundRows.map((row) => [row.reservationId, row.amount]));

  const roomTypesById = new Map<string, string[]>();
  for (const room of roomRows) {
    const names = roomTypesById.get(room.reservationId) ?? [];
    names.push(room.roomTypeName);
    roomTypesById.set(room.reservationId, names);
  }

  const methodNamesById = new Map<string, Set<string>>();
  for (const row of methodRows) {
    const names = methodNamesById.get(row.reservationId) ?? new Set<string>();
    names.add(row.methodName);
    methodNamesById.set(row.reservationId, names);
  }

  // Build per-reservation rows and aggregate totals + by source.
  const totals = emptyTotals();
  const bySourceMap = new Map<RevenueReportSource, RevenueBySource>(
    allSources.map((source) => [source, emptyBySource(source)]),
  );

  const items: RevenueReportRow[] = reservationRows.map((row) => {
    const source = row.source as RevenueReportSource;
    const gross = grossById.get(row.id) ?? 0;
    const grossPaid = grossPaidById.get(row.id) ?? 0;
    const refunded = refundedById.get(row.id) ?? 0;
    const netPaid = Math.max(0, grossPaid - refunded);
    const isInactive = inactiveStatuses.includes(row.reservationStatus);
    const outstanding = isInactive ? 0 : Math.max(0, gross - netPaid);
    const netCollected = Math.max(0, grossPaid - refunded);

    totals.reservations += 1;
    totals.gross += gross;
    totals.paid += grossPaid;
    totals.refunded += refunded;
    totals.outstanding += outstanding;

    const bucket = bySourceMap.get(source);
    if (bucket) {
      bucket.reservations += 1;
      bucket.gross += gross;
      bucket.paid += grossPaid;
      bucket.refunded += refunded;
      bucket.outstanding += outstanding;
      bucket.netCollected += netCollected;
    }

    return {
      id: row.id,
      bookingCode: row.bookingCode,
      guest: { fullName: row.guestFullName, phone: row.guestPhone },
      source,
      reservationStatus: row.reservationStatus,
      paymentStatus: row.paymentStatus,
      methodNames: [...(methodNamesById.get(row.id) ?? [])],
      bookingDate: row.bookingDate,
      paymentDate: paidAtById.get(row.id) ?? null,
      checkInDate: row.checkInDate,
      roomTypes: roomTypesById.get(row.id) ?? [],
      gross,
      // No discount is persisted in the data model; kept for a stable report contract.
      discount: 0,
      net: gross,
      paid: grossPaid,
      refunded,
      outstanding,
      netCollected,
    };
  });

  totals.discount = 0;
  totals.net = totals.gross - totals.discount;
  totals.netCollected = totals.paid - totals.refunded;

  // By payment method: group succeeded payments; transactions counts payments, paid is net.
  const byMethodMap = new Map<string, RevenueByMethod>();
  for (const row of methodRows) {
    const bucket = byMethodMap.get(row.methodId) ?? {
      methodId: row.methodId,
      methodName: row.methodName,
      transactions: 0,
      paid: 0,
      refunded: 0,
      netCollected: 0,
    };
    bucket.transactions += 1;
    bucket.paid += row.amount;
    bucket.refunded += row.refunded;
    bucket.netCollected += row.amount - row.refunded;
    byMethodMap.set(row.methodId, bucket);
  }
  totals.transactions = methodRows.length;

  return {
    totals,
    bySource: allSources.map((source) => bySourceMap.get(source)!),
    byMethod: [...byMethodMap.values()].sort((a, b) => b.netCollected - a.netCollected),
    items,
  };
}

// Range predicate reused inside the correlated EXISTS subquery for payment-date mode.
function paymentDateInRangeFor(alias: SQL, from?: string, to?: string): SQL {
  const column = sql`(coalesce(${alias}.paid_at, ${alias}.created_at) at time zone 'Asia/Jakarta')::date`;
  const clauses: SQL[] = [];
  if (from) clauses.push(sql`${column} >= ${from}::date`);
  if (to) clauses.push(sql`${column} <= ${to}::date`);
  return clauses.length ? (and(...clauses) as SQL) : sql`true`;
}

function emptyTotals(): RevenueTotals {
  return {
    reservations: 0,
    transactions: 0,
    gross: 0,
    discount: 0,
    net: 0,
    paid: 0,
    refunded: 0,
    outstanding: 0,
    netCollected: 0,
  };
}

function emptyBySource(source: RevenueReportSource): RevenueBySource {
  return {
    source,
    reservations: 0,
    gross: 0,
    paid: 0,
    refunded: 0,
    outstanding: 0,
    netCollected: 0,
  };
}
