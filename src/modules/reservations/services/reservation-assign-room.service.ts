import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { roomChangeHistory } from "../../../db/schema/room_change_history.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import type { Database } from "../../../plugins/database.js";
import { readActiveMaintenanceBlocks } from "../../rooms/services/room-maintenance.service.js";
import type {
  AssignRoomBody,
  AssignRoomParams,
  AssignRoomsByTypeBody,
} from "../schemas/reservations-assign-room.schema.js";
import { recordReservationEvent } from "./reservation-events.service.js";
import { bookingDateJakarta } from "./reservations-campaigns.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function assignmentUnavailableReasons(
  unit: typeof roomUnits.$inferSelect | undefined,
  roomTypeId: string,
  checkInDate: string,
  overlaps: boolean,
  maintenanceBlocked: boolean,
): string[] {
  if (!unit || unit.roomTypeId !== roomTypeId) return ["wrong_room_type_or_missing"];
  const reasons: string[] = [];
  if (!unit.isActive) reasons.push("inactive");
  if (["maintenance", "out_of_service"].includes(unit.operationalStatus)) {
    reasons.push(unit.operationalStatus);
  } else if (checkInDate <= bookingDateJakarta() && unit.operationalStatus !== "available") {
    reasons.push("not_ready");
  }
  if (overlaps) reasons.push("overlapping_reservation");
  if (maintenanceBlocked) reasons.push("maintenance_block");
  return reasons;
}

export class AssignRoomError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export async function readReservationAssignmentOptions(db: Database, params: AssignRoomParams) {
  const [reservation] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, params.id))
    .limit(1);
  if (!reservation) {
    throw new AssignRoomError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
  }
  if (
    reservation.reservationStatus !== "pending" &&
    reservation.reservationStatus !== "confirmed"
  ) {
    throw new AssignRoomError(
      "ASSIGNMENT_NOT_ALLOWED",
      "Room assignment is only available before check-in",
    );
  }
  const [room] = await db
    .select()
    .from(reservationRooms)
    .where(
      and(
        eq(reservationRooms.id, params.roomId),
        eq(reservationRooms.reservationId, reservation.id),
      ),
    )
    .limit(1);
  if (!room) {
    throw new AssignRoomError("RESERVATION_ROOM_NOT_FOUND", "Reservation room not found", 404);
  }

  const unassignedRooms = await db
    .select({
      id: reservationRooms.id,
      adults: reservationRooms.adults,
      children: reservationRooms.children,
    })
    .from(reservationRooms)
    .where(
      and(
        eq(reservationRooms.reservationId, reservation.id),
        eq(reservationRooms.roomTypeId, room.roomTypeId),
        isNull(reservationRooms.roomUnitId),
      ),
    )
    .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id));

  const [units, overlaps, maintenanceBlocks] = await Promise.all([
    db
      .select({ unit: roomUnits, floorName: masterItems.name })
      .from(roomUnits)
      .leftJoin(masterItems, eq(roomUnits.floorId, masterItems.id))
      .where(eq(roomUnits.roomTypeId, room.roomTypeId))
      .orderBy(asc(roomUnits.roomNumber), asc(roomUnits.id)),
    db
      .select({ roomUnitId: reservationRooms.roomUnitId })
      .from(reservationRooms)
      .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
      .where(
        and(
          eq(reservationRooms.roomTypeId, room.roomTypeId),
          ne(reservationRooms.id, room.id),
          inArray(reservations.reservationStatus, ["pending", "confirmed", "checked_in"]),
          lt(reservations.checkInDate, reservation.checkOutDate),
          gt(reservations.checkOutDate, reservation.checkInDate),
        ),
      ),
    readActiveMaintenanceBlocks(db, reservation.checkInDate, reservation.checkOutDate, [room.roomTypeId]),
  ]);
  const overlappingUnitIds = new Set(
    overlaps.map((overlap) => overlap.roomUnitId).filter((id): id is string => id !== null),
  );
  const blockedUnitIds = new Set(maintenanceBlocks.map((block) => block.roomUnitId));

  return {
    reservation: {
      id: reservation.id,
      bookingCode: reservation.bookingCode,
      reservationStatus: reservation.reservationStatus,
      version: reservation.version,
      checkInDate: reservation.checkInDate,
      checkOutDate: reservation.checkOutDate,
    },
    room: {
      id: room.id,
      roomTypeId: room.roomTypeId,
      roomTypeName: room.roomTypeNameSnapshot,
      roomUnitId: room.roomUnitId,
    },
    rooms: unassignedRooms,
    options: units.map(({ unit, floorName }) => {
      const isCurrent = unit.id === room.roomUnitId;
      const unavailableReasons = isCurrent
        ? []
        : assignmentUnavailableReasons(
            unit,
            room.roomTypeId,
            reservation.checkInDate,
            overlappingUnitIds.has(unit.id),
            blockedUnitIds.has(unit.id),
          );
      return {
        id: unit.id,
        roomNumber: unit.roomNumber,
        floorId: unit.floorId,
        floorName,
        bedConfiguration: unit.bedConfiguration,
        operationalStatus: unit.operationalStatus,
        isActive: unit.isActive,
        isCurrent,
        canAssign: unavailableReasons.length === 0,
        unavailableReasons,
      };
    }),
  };
}

export async function assignReservationRoomsByType(
  tx: Transaction,
  params: AssignRoomParams,
  body: AssignRoomsByTypeBody,
  actorUserId: string,
) {
  const [reservation] = await tx
    .select()
    .from(reservations)
    .where(eq(reservations.id, params.id))
    .for("update")
    .limit(1);
  if (!reservation) {
    throw new AssignRoomError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
  }
  if (!["pending", "confirmed"].includes(reservation.reservationStatus)) {
    throw new AssignRoomError(
      "ASSIGNMENT_NOT_ALLOWED",
      "Room assignment is only available before check-in",
    );
  }
  if (reservation.version !== body.expectedVersion) {
    throw new AssignRoomError(
      "VERSION_CONFLICT",
      "Reservation has changed; reload its details before assigning rooms",
    );
  }

  const [anchor] = await tx
    .select({ roomTypeId: reservationRooms.roomTypeId, roomUnitId: reservationRooms.roomUnitId })
    .from(reservationRooms)
    .where(
      and(
        eq(reservationRooms.id, params.roomId),
        eq(reservationRooms.reservationId, reservation.id),
      ),
    )
    .limit(1);
  if (!anchor) {
    throw new AssignRoomError("RESERVATION_ROOM_NOT_FOUND", "Reservation room not found", 404);
  }
  if (anchor.roomUnitId) {
    throw new AssignRoomError("ASSIGNMENT_NOT_ALLOWED", "Selected reservation room is already assigned");
  }

  const unassignedRooms = await tx
    .select({ id: reservationRooms.id })
    .from(reservationRooms)
    .where(
      and(
        eq(reservationRooms.reservationId, reservation.id),
        eq(reservationRooms.roomTypeId, anchor.roomTypeId),
        isNull(reservationRooms.roomUnitId),
      ),
    )
    .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id));
  const expectedRoomIds = new Set(unassignedRooms.map((room) => room.id));
  const assignments = new Map(body.assignments.map((item) => [item.reservationRoomId, item.roomUnitId]));
  if (
    assignments.size !== body.assignments.length ||
    assignments.size !== expectedRoomIds.size ||
    [...assignments.keys()].some((id) => !expectedRoomIds.has(id))
  ) {
    throw new AssignRoomError(
      "INVALID_ASSIGNMENTS",
      "Assign every unassigned room of this room type exactly once",
    );
  }
  if (new Set(assignments.values()).size !== assignments.size) {
    throw new AssignRoomError("DUPLICATE_ROOM_UNIT", "Each reservation room needs a different room number");
  }

  let version = reservation.version;
  const rooms = [];
  for (const room of unassignedRooms) {
    const result = await assignReservationRoom(
      tx,
      { id: reservation.id, roomId: room.id },
      { roomUnitId: assignments.get(room.id)!, expectedVersion: version },
      actorUserId,
    );
    version = result.reservation.version;
    rooms.push(result.room);
  }
  return {
    changed: true,
    reservation: { id: reservation.id, bookingCode: reservation.bookingCode, version },
    rooms,
  };
}

export async function assignReservationRoom(
  tx: Transaction,
  params: AssignRoomParams,
  body: AssignRoomBody,
  actorUserId: string,
) {
  const [reservation] = await tx
    .select()
    .from(reservations)
    .where(eq(reservations.id, params.id))
    .for("update")
    .limit(1);
  if (!reservation) {
    throw new AssignRoomError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
  }
  if (
    reservation.reservationStatus !== "pending" &&
    reservation.reservationStatus !== "confirmed"
  ) {
    throw new AssignRoomError(
      "ASSIGNMENT_NOT_ALLOWED",
      "Room assignment can only be changed before check-in",
    );
  }
  if (reservation.version !== body.expectedVersion) {
    throw new AssignRoomError(
      "VERSION_CONFLICT",
      "Reservation has changed; reload its details before assigning a room",
    );
  }

  const [room] = await tx
    .select()
    .from(reservationRooms)
    .where(
      and(
        eq(reservationRooms.id, params.roomId),
        eq(reservationRooms.reservationId, reservation.id),
      ),
    )
    .limit(1);
  if (!room) {
    throw new AssignRoomError("RESERVATION_ROOM_NOT_FOUND", "Reservation room not found", 404);
  }

  const [previousUnit] = room.roomUnitId
    ? await tx
        .select({ roomNumber: roomUnits.roomNumber })
        .from(roomUnits)
        .where(eq(roomUnits.id, room.roomUnitId))
        .limit(1)
    : [];
  if (room.roomUnitId === body.roomUnitId) {
    return {
      changed: false,
      reservation: {
        id: reservation.id,
        bookingCode: reservation.bookingCode,
        reservationStatus: reservation.reservationStatus,
        paymentStatus: reservation.paymentStatus,
        version: reservation.version,
      },
      room: {
        id: room.id,
        roomTypeId: room.roomTypeId,
        roomTypeName: room.roomTypeNameSnapshot,
        roomUnitId: room.roomUnitId,
        roomNumber: previousUnit?.roomNumber ?? null,
        bedConfiguration: room.bedConfigurationSnapshot,
      },
    };
  }

  const [targetUnit] = body.roomUnitId
    ? await tx
        .select()
        .from(roomUnits)
        .where(eq(roomUnits.id, body.roomUnitId))
        .for("update")
        .limit(1)
    : [];
  if (body.roomUnitId) {
    const maintenanceBlocks = await readActiveMaintenanceBlocks(
      tx,
      reservation.checkInDate,
      reservation.checkOutDate,
      [room.roomTypeId],
    );
    const targetUnavailableReasons = assignmentUnavailableReasons(
      targetUnit,
      room.roomTypeId,
      reservation.checkInDate,
      false,
      maintenanceBlocks.some((block) => block.roomUnitId === body.roomUnitId),
    );
    if (targetUnavailableReasons.length > 0) {
      throw new AssignRoomError(
        "ROOM_UNIT_UNAVAILABLE",
        "Selected room is unavailable for this room type or check-in date",
      );
    }

    const [overlap] = await tx
      .select({ id: reservationRooms.id })
      .from(reservationRooms)
      .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
      .where(
        and(
          eq(reservationRooms.roomUnitId, body.roomUnitId),
          ne(reservationRooms.id, room.id),
          inArray(reservations.reservationStatus, ["pending", "confirmed", "checked_in"]),
          lt(reservations.checkInDate, reservation.checkOutDate),
          gt(reservations.checkOutDate, reservation.checkInDate),
        ),
      )
      .limit(1);
    if (overlap) {
      throw new AssignRoomError(
        "ROOM_UNIT_UNAVAILABLE",
        "Selected room is already assigned to an overlapping reservation",
      );
    }
  }

  const changedAt = new Date();
  await tx
    .update(reservationRooms)
    .set({
      roomUnitId: body.roomUnitId,
      bedConfigurationSnapshot: targetUnit?.bedConfiguration ?? null,
      updatedAt: changedAt,
    })
    .where(eq(reservationRooms.id, room.id));
  const [updatedReservation] = await tx
    .update(reservations)
    .set({ version: sql`${reservations.version} + 1`, updatedAt: changedAt })
    .where(eq(reservations.id, reservation.id))
    .returning({ version: reservations.version });

  await tx.insert(roomChangeHistory).values({
    reservationRoomId: room.id,
    fromRoomTypeId: room.roomTypeId,
    toRoomTypeId: room.roomTypeId,
    fromRoomUnitId: room.roomUnitId,
    toRoomUnitId: body.roomUnitId,
    priceDifference: 0,
    reason: body.reason?.trim() || null,
    changedByUserId: actorUserId,
    createdAt: changedAt,
  });
  await recordReservationEvent(tx, {
    reservationId: reservation.id,
    eventType: body.roomUnitId
      ? room.roomUnitId
        ? "reservation.room_reassigned"
        : "reservation.room_assigned"
      : "reservation.room_unassigned",
    actorType: "user",
    actorUserId,
    occurredAt: changedAt,
    reservationStatusBefore: reservation.reservationStatus,
    reservationStatusAfter: reservation.reservationStatus,
    paymentStatusBefore: reservation.paymentStatus,
    paymentStatusAfter: reservation.paymentStatus,
    referenceId: room.id,
    details: {
      reservationRoomId: room.id,
      roomTypeId: room.roomTypeId,
      previousRoomUnitId: room.roomUnitId,
      previousRoomNumber: previousUnit?.roomNumber ?? null,
      roomUnitId: body.roomUnitId,
      roomNumber: targetUnit?.roomNumber ?? null,
      reason: body.reason?.trim() || null,
    },
  });

  return {
    changed: true,
    reservation: {
      id: reservation.id,
      bookingCode: reservation.bookingCode,
      reservationStatus: reservation.reservationStatus,
      paymentStatus: reservation.paymentStatus,
      version: updatedReservation.version,
    },
    room: {
      id: room.id,
      roomTypeId: room.roomTypeId,
      roomTypeName: room.roomTypeNameSnapshot,
      roomUnitId: body.roomUnitId,
      roomNumber: targetUnit?.roomNumber ?? null,
      bedConfiguration: targetUnit?.bedConfiguration ?? null,
    },
  };
}
