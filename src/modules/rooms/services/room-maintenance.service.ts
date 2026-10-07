import { and, asc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomMaintenanceBlocks } from "../../../db/schema/room_maintenance_blocks.schema.js";
import { roomTypes } from "../../../db/schema/room_types.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import type { Database } from "../../../plugins/database.js";
import type {
  CreateMaintenanceBody,
  MaintenanceListQuery,
} from "../schemas/room-maintenance.schema.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;

export class MaintenanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export function maintenanceDates(startDate: string, endDate: string): string[] | null {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== startDate ||
    end.toISOString().slice(0, 10) !== endDate ||
    end <= start
  )
    return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days > 366) return null;
  return Array.from({ length: days }, (_, index) =>
    new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}

export async function readActiveMaintenanceBlocks(
  db: QueryDatabase,
  startDate: string,
  endDate: string,
  roomTypeIds?: string[],
) {
  if (roomTypeIds?.length === 0) return [];
  return db
    .select({
      id: roomMaintenanceBlocks.id,
      roomUnitId: roomMaintenanceBlocks.roomUnitId,
      roomTypeId: roomUnits.roomTypeId,
      startDate: roomMaintenanceBlocks.startDate,
      endDate: roomMaintenanceBlocks.endDate,
      reason: roomMaintenanceBlocks.reason,
    })
    .from(roomMaintenanceBlocks)
    .innerJoin(roomUnits, eq(roomMaintenanceBlocks.roomUnitId, roomUnits.id))
    .where(
      and(
        isNull(roomMaintenanceBlocks.cancelledAt),
        lt(roomMaintenanceBlocks.startDate, endDate),
        gt(roomMaintenanceBlocks.endDate, startDate),
        roomTypeIds ? inArray(roomUnits.roomTypeId, roomTypeIds) : undefined,
      ),
    );
}

export async function listMaintenanceBlocks(db: Database, query: MaintenanceListQuery) {
  const rows = await db
    .select({
      block: roomMaintenanceBlocks,
      roomNumber: roomUnits.roomNumber,
      roomTypeId: roomTypes.id,
      roomTypeName: roomTypes.name,
    })
    .from(roomMaintenanceBlocks)
    .innerJoin(roomUnits, eq(roomMaintenanceBlocks.roomUnitId, roomUnits.id))
    .innerJoin(roomTypes, eq(roomUnits.roomTypeId, roomTypes.id))
    .where(
      and(
        lt(roomMaintenanceBlocks.startDate, query.endDate),
        gt(roomMaintenanceBlocks.endDate, query.startDate),
        query.includeCancelled ? undefined : isNull(roomMaintenanceBlocks.cancelledAt),
        query.roomTypeId ? eq(roomTypes.id, query.roomTypeId) : undefined,
        query.roomUnitId ? eq(roomUnits.id, query.roomUnitId) : undefined,
      ),
    )
    .orderBy(asc(roomMaintenanceBlocks.startDate), asc(roomUnits.roomNumber));
  return { items: rows.map(({ block, ...room }) => ({ ...block, ...room })) };
}

export async function createMaintenanceBlock(
  tx: Transaction,
  body: CreateMaintenanceBody,
  actorUserId: string,
) {
  const dates = maintenanceDates(body.startDate, body.endDate);
  if (!dates) {
    throw new MaintenanceError("INVALID_DATE_RANGE", "Use a valid range of 1 to 366 nights", 400);
  }
  const reason = body.reason.trim();
  if (!reason) throw new MaintenanceError("INVALID_REASON", "Reason is required", 400);

  const [target] = await tx
    .select()
    .from(roomUnits)
    .where(eq(roomUnits.id, body.roomUnitId))
    .limit(1);
  if (!target) throw new MaintenanceError("ROOM_NOT_FOUND", "Room number not found", 404);

  // Reservation creation uses this same lock before checking nightly capacity.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${target.roomTypeId}))`);
  const units = await tx
    .select()
    .from(roomUnits)
    .where(eq(roomUnits.roomTypeId, target.roomTypeId))
    .orderBy(asc(roomUnits.id))
    .for("update");
  const lockedTarget = units.find((unit) => unit.id === body.roomUnitId);
  if (
    !lockedTarget?.isActive ||
    ["maintenance", "out_of_service"].includes(lockedTarget.operationalStatus)
  ) {
    throw new MaintenanceError("ROOM_UNAVAILABLE", "Room number is inactive or unavailable");
  }

  const [existingBlocks, bookings] = await Promise.all([
    readActiveMaintenanceBlocks(tx, body.startDate, body.endDate, [target.roomTypeId]),
    tx
      .select({
        roomUnitId: reservationRooms.roomUnitId,
        checkInDate: reservations.checkInDate,
        checkOutDate: reservations.checkOutDate,
      })
      .from(reservationRooms)
      .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
      .where(
        and(
          eq(reservationRooms.roomTypeId, target.roomTypeId),
          inArray(reservations.reservationStatus, ["pending", "confirmed", "checked_in"]),
          lt(reservations.checkInDate, body.endDate),
          gt(reservations.checkOutDate, body.startDate),
        ),
      ),
  ]);
  if (existingBlocks.some((block) => block.roomUnitId === target.id)) {
    throw new MaintenanceError(
      "MAINTENANCE_OVERLAP",
      "Room already has a maintenance block in this range",
    );
  }
  if (
    bookings.some(
      (booking) =>
        booking.roomUnitId === target.id &&
        booking.checkInDate < body.endDate &&
        booking.checkOutDate > body.startDate,
    )
  ) {
    throw new MaintenanceError(
      "ROOM_HAS_RESERVATION",
      "Room is assigned to a reservation in this range",
    );
  }

  const operationalUnits = units.filter(
    (unit) => unit.isActive && !["maintenance", "out_of_service"].includes(unit.operationalStatus),
  );
  for (const stayDate of dates) {
    const blockedIds = new Set(
      existingBlocks
        .filter((block) => block.startDate <= stayDate && block.endDate > stayDate)
        .map((block) => block.roomUnitId),
    );
    blockedIds.add(target.id);
    const remainingRooms = operationalUnits.filter((unit) => !blockedIds.has(unit.id)).length;
    const bookedRooms = bookings.filter(
      (booking) => booking.checkInDate <= stayDate && booking.checkOutDate > stayDate,
    ).length;
    if (bookedRooms > remainingRooms) {
      throw new MaintenanceError(
        "INSUFFICIENT_ROOM_CAPACITY",
        `Maintenance would leave fewer rooms than active reservations on ${stayDate}`,
      );
    }
  }

  const [created] = await tx
    .insert(roomMaintenanceBlocks)
    .values({
      roomUnitId: target.id,
      startDate: body.startDate,
      endDate: body.endDate,
      reason,
      createdByUserId: actorUserId,
    })
    .returning();
  return { ...created, roomNumber: target.roomNumber, roomTypeId: target.roomTypeId };
}

export async function cancelMaintenanceBlock(tx: Transaction, id: string, actorUserId: string) {
  const [block] = await tx
    .select()
    .from(roomMaintenanceBlocks)
    .where(eq(roomMaintenanceBlocks.id, id))
    .for("update")
    .limit(1);
  if (!block)
    throw new MaintenanceError("MAINTENANCE_NOT_FOUND", "Maintenance block not found", 404);
  if (block.cancelledAt) return { ...block, alreadyCancelled: true };
  const [updated] = await tx
    .update(roomMaintenanceBlocks)
    .set({ cancelledAt: new Date(), cancelledByUserId: actorUserId, updatedAt: new Date() })
    .where(eq(roomMaintenanceBlocks.id, id))
    .returning();
  return { ...updated, alreadyCancelled: false };
}
