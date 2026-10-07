import { and, count, eq, gt, gte, inArray, lt, lte, notInArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { roomInventoryDaily } from "../../../db/schema/room_inventory_daily.schema.js";
import { roomTypes } from "../../../db/schema/room_types.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import { readActiveMaintenanceBlocks } from "../../rooms/services/room-maintenance.service.js";
import {
  bookingDateJakarta,
  previewDailyCampaignPrices,
} from "../../reservations/services/reservations-campaigns.service.js";
import {
  inventoryBulkBodySchema,
  inventoryListQuerySchema,
  inventoryRangeBodySchema,
  type BulkInventoryBody,
  type InventoryChange,
  type RangeInventoryBody,
} from "../schemas/prices-stocks.schema.js";

type ListQuery = {
  roomTypeId: string;
  startDate: string;
  endDate: string;
  page?: number;
  limit?: number;
};

const errorBody = (code: string, message: string) => ({ error: { code, message } });

class InventoryConflict extends Error {}
class InventoryIncomplete extends Error {}

function parseStayDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function nextDate(value: string): string {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

function dateRange(start: string, end: string): string[] | null {
  const startDate = parseStayDate(start);
  const endDate = parseStayDate(end);
  if (!startDate || !endDate || endDate < startDate) return null;
  const days = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
  if (days > 366) return null;
  return Array.from({ length: days }, (_, index) =>
    new Date(startDate.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}

async function getRoomTypeAndStockLimit(
  app: Parameters<FastifyPluginAsync>[0],
  roomTypeId: string,
) {
  const [[roomType], [stock], [physicalRooms]] = await Promise.all([
    app.db
      .select({
        id: roomTypes.id,
        name: roomTypes.name,
        basePricePerNight: roomTypes.basePricePerNight,
        isActive: roomTypes.isActive,
      })
      .from(roomTypes)
      .where(eq(roomTypes.id, roomTypeId))
      .limit(1),
    app.db
      .select({ total: count() })
      .from(roomUnits)
      .where(and(eq(roomUnits.roomTypeId, roomTypeId), eq(roomUnits.isActive, true))),
    app.db
      .select({ total: count() })
      .from(roomUnits)
      .where(eq(roomUnits.roomTypeId, roomTypeId)),
  ]);
  return { roomType, stockLimit: stock.total, totalRoomCount: physicalRooms.total };
}

function changedFields(change: InventoryChange): string[] {
  return (["basePrice", "sellableStock", "minNights", "stopSell"] as const).filter(
    (field) => change[field] !== undefined,
  );
}

export const pricesStocksRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("prices_stocks.view"),
      schema: { querystring: inventoryListQuerySchema },
    },
    async (request, reply) => {
      const { roomTypeId, startDate, endDate, page = 1, limit = 30 } = request.query;
      const dates = dateRange(startDate, endDate);
      if (!dates) {
        return reply
          .code(400)
          .send(errorBody("INVALID_DATE_RANGE", "Use valid dates in a range of at most 366 days"));
      }
      const { roomType, stockLimit, totalRoomCount } = await getRoomTypeAndStockLimit(app, roomTypeId);
      if (!roomType) return reply.code(404).send(errorBody("NOT_FOUND", "Room type not found"));

      const visibleDates = dates.slice((page - 1) * limit, page * limit);
      const [configured, bookedRooms, operationalRooms, maintenanceBlocks] = visibleDates.length
        ? await Promise.all([
            app.db
              .select()
              .from(roomInventoryDaily)
              .where(
                and(
                  eq(roomInventoryDaily.roomTypeId, roomTypeId),
                  gte(roomInventoryDaily.stayDate, visibleDates[0]),
                  lte(roomInventoryDaily.stayDate, visibleDates[visibleDates.length - 1]),
                ),
              ),
            app.db
              .select({
                checkInDate: reservations.checkInDate,
                checkOutDate: reservations.checkOutDate,
              })
              .from(reservationRooms)
              .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
              .where(
                and(
                  eq(reservationRooms.roomTypeId, roomTypeId),
                  inArray(reservations.reservationStatus, ["pending", "confirmed", "checked_in"]),
                  lt(reservations.checkInDate, nextDate(visibleDates[visibleDates.length - 1])),
                  gt(reservations.checkOutDate, visibleDates[0]),
                ),
              ),
            app.db
              .select({ id: roomUnits.id })
              .from(roomUnits)
              .where(
                and(
                  eq(roomUnits.roomTypeId, roomTypeId),
                  eq(roomUnits.isActive, true),
                  notInArray(roomUnits.operationalStatus, ["maintenance", "out_of_service"]),
                ),
              ),
            readActiveMaintenanceBlocks(
              app.db,
              visibleDates[0],
              nextDate(visibleDates[visibleDates.length - 1]),
              [roomTypeId],
            ),
          ])
        : [[], [], [], []];
      const byDate = new Map(configured.map((row) => [row.stayDate, row]));
      const operationalUnitIds = new Set(operationalRooms.map((room) => room.id));
      const bookingDate = bookingDateJakarta();
      const campaignPreviews = visibleDates.length
        ? await previewDailyCampaignPrices(app.db, {
            bookingDate,
            roomTypeId,
            rows: visibleDates.map((stayDate) => ({
              stayDate,
              basePrice: byDate.get(stayDate)?.basePrice ?? null,
            })),
          })
        : [];
      const items = visibleDates.map((stayDate) => {
        const row = byDate.get(stayDate);
        const preview = campaignPreviews.find((item) => item.stayDate === stayDate);
        const bookedCount = bookedRooms.filter(
          (booking) => booking.checkInDate <= stayDate && booking.checkOutDate > stayDate,
        ).length;
        const maintenanceBlockedRooms = new Set(
          maintenanceBlocks
            .filter((block) =>
              block.startDate <= stayDate &&
              block.endDate > stayDate &&
              operationalUnitIds.has(block.roomUnitId)
            )
            .map((block) => block.roomUnitId),
        ).size;
        return row
          ? {
              ...row,
              isConfigured: true,
              bookedRooms: bookedCount,
              maintenanceBlockedRooms,
              remainingStock: Math.max(0, row.sellableStock - bookedCount),
              availableRooms: row.stopSell
                ? 0
                : Math.max(0, Math.min(row.sellableStock, operationalRooms.length - maintenanceBlockedRooms) - bookedCount),
              websitePromo: preview?.website.promo ?? null,
              webPrice: preview?.website.price ?? null,
              frontDeskPromo: preview?.frontDesk.promo ?? null,
              frontDeskPrice: preview?.frontDesk.price ?? null,
            }
          : {
              id: null,
              roomTypeId,
              stayDate,
              basePrice: null,
              sellableStock: null,
              minNights: null,
              stopSell: null,
              version: null,
              isConfigured: false,
              bookedRooms: bookedCount,
              maintenanceBlockedRooms,
              remainingStock: null,
              availableRooms: null,
              websitePromo: null,
              webPrice: null,
              frontDeskPromo: null,
              frontDeskPrice: null,
            };
      });
      return {
        roomType,
        totalRoomCount,
        stockLimit,
        operationalRoomCount: operationalRooms.length,
        campaignPreviewBookingDate: bookingDate,
        items,
        page,
        limit,
        total: dates.length,
      };
    },
  );

  app.put<{ Body: RangeInventoryBody }>(
    "/bulk",
    {
      preHandler: app.requirePermission("prices_stocks.view"),
      schema: { body: inventoryRangeBodySchema },
    },
    async (request, reply) => {
      const {
        roomTypeId,
        startDate,
        endDate,
        fields,
        applicableWeekdays,
        customDayPrices = [],
      } = request.body;
      const range = dateRange(startDate, endDate);
      if (!range) {
        return reply
          .code(400)
          .send(errorBody("INVALID_DATE_RANGE", "Use valid dates in a range of at most 366 days"));
      }
      if (Object.keys(fields).length === 0 && customDayPrices.length === 0) {
        return reply.code(400).send(errorBody("EMPTY_CHANGE", "Select at least one field"));
      }
      const customWeekdays = customDayPrices.map((item) => item.weekday);
      if (new Set(customWeekdays).size !== customWeekdays.length) {
        return reply
          .code(400)
          .send(errorBody("DUPLICATE_WEEKDAY", "Custom day prices must use unique weekdays"));
      }
      const selectedWeekdays = new Set(applicableWeekdays ?? [1, 2, 3, 4, 5, 6, 7]);
      if (customWeekdays.some((weekday) => !selectedWeekdays.has(weekday))) {
        return reply
          .code(400)
          .send(errorBody("INVALID_WEEKDAY", "A custom price weekday must be applicable"));
      }
      const customPriceByDay = new Map(
        customDayPrices.map((item) => [item.weekday, item.basePrice]),
      );
      const hasOtherFields =
        fields.basePrice !== undefined ||
        fields.sellableStock !== undefined ||
        fields.minNights !== undefined ||
        fields.stopSell !== undefined;
      const dates = range
        .map((stayDate) => {
          const weekday = new Date(`${stayDate}T00:00:00.000Z`).getUTCDay() || 7;
          return { stayDate, weekday };
        })
        .filter(
          ({ weekday }) =>
            selectedWeekdays.has(weekday) && (hasOtherFields || customPriceByDay.has(weekday)),
        );
      if (dates.length === 0) {
        return reply
          .code(400)
          .send(errorBody("NO_MATCHING_DATES", "No dates match the selected weekdays"));
      }

      const permissions = new Set<string>();
      if (fields.basePrice !== undefined || customDayPrices.length)
        permissions.add("prices_stocks.update_price");
      if (fields.sellableStock !== undefined) permissions.add("prices_stocks.update_stock");
      if (fields.minNights !== undefined) permissions.add("prices_stocks.manage_minimum_night");
      if (fields.stopSell !== undefined) permissions.add("prices_stocks.manage_stop_sell");
      for (const permission of permissions) {
        await app.requirePermission(permission)(request, reply);
        if (reply.sent) return;
      }

      const { roomType, stockLimit } = await getRoomTypeAndStockLimit(app, roomTypeId);
      if (!roomType) return reply.code(404).send(errorBody("NOT_FOUND", "Room type not found"));
      if (!roomType.isActive)
        return reply.code(409).send(errorBody("ROOM_TYPE_INACTIVE", "Room type is inactive"));
      if (fields.sellableStock !== undefined && fields.sellableStock > stockLimit) {
        return reply
          .code(400)
          .send(
            errorBody(
              "STOCK_EXCEEDS_ROOMS",
              `Sellable stock cannot exceed ${stockLimit} active rooms`,
            ),
          );
      }

      const withPrice = dates.filter(
        ({ weekday }) => customPriceByDay.has(weekday) || fields.basePrice !== undefined,
      );
      const withoutPrice = dates.filter(
        ({ weekday }) => !customPriceByDay.has(weekday) && fields.basePrice === undefined,
      );
      const now = new Date();
      try {
        await app.db.transaction(async (tx) => {
          const configured = await tx
            .select({ stayDate: roomInventoryDaily.stayDate })
            .from(roomInventoryDaily)
            .where(
              and(
                eq(roomInventoryDaily.roomTypeId, roomTypeId),
                inArray(
                  roomInventoryDaily.stayDate,
                  dates.map((item) => item.stayDate),
                ),
              ),
            )
            .for("update");
          const configuredDates = new Set(configured.map((item) => item.stayDate));
          const incomplete = dates.find(
            ({ stayDate, weekday }) =>
              !configuredDates.has(stayDate) &&
              (fields.sellableStock === undefined ||
                (fields.basePrice === undefined && !customPriceByDay.has(weekday))),
          );
          if (incomplete) {
            throw new InventoryIncomplete(
              `New date ${incomplete.stayDate} requires both basePrice and sellableStock`,
            );
          }

          for (const group of [withPrice, withoutPrice]) {
            if (!group.length) continue;
            const updates = {
              ...(group === withPrice ? { basePrice: sql`excluded.base_price` } : {}),
              ...(fields.sellableStock !== undefined
                ? { sellableStock: sql`excluded.sellable_stock` }
                : {}),
              ...(fields.minNights !== undefined ? { minNights: sql`excluded.min_nights` } : {}),
              ...(fields.stopSell !== undefined ? { stopSell: sql`excluded.stop_sell` } : {}),
              version: sql`${roomInventoryDaily.version} + 1`,
              updatedAt: now,
            };
            await tx
              .insert(roomInventoryDaily)
              .values(
                group.map(({ stayDate, weekday }) => ({
                  roomTypeId,
                  stayDate,
                  basePrice: customPriceByDay.get(weekday) ?? fields.basePrice ?? 0,
                  sellableStock: fields.sellableStock ?? 0,
                  minNights: fields.minNights ?? 1,
                  stopSell: fields.stopSell ?? false,
                })),
              )
              .onConflictDoUpdate({
                target: [roomInventoryDaily.roomTypeId, roomInventoryDaily.stayDate],
                set: updates,
              });
          }
        });
      } catch (error) {
        if (error instanceof InventoryIncomplete) {
          return reply.code(400).send(errorBody("INCOMPLETE_NEW_DATE", error.message));
        }
        throw error;
      }
      return { updated: dates.length, startDate, endDate };
    },
  );

  app.put<{ Body: BulkInventoryBody }>(
    "/bulk/rows",
    {
      preHandler: app.requirePermission("prices_stocks.view"),
      schema: { body: inventoryBulkBodySchema },
    },
    async (request, reply) => {
      const { roomTypeId, changes } = request.body;
      const dates = changes.map((change) => change.stayDate);
      if (dates.some((date) => !parseStayDate(date)) || new Set(dates).size !== dates.length) {
        return reply
          .code(400)
          .send(errorBody("INVALID_DATES", "Stay dates must be valid and unique"));
      }
      if (changes.some((change) => changedFields(change).length === 0)) {
        return reply
          .code(400)
          .send(errorBody("EMPTY_CHANGE", "Every row must change at least one field"));
      }

      const permissions = new Set<string>();
      for (const change of changes) {
        if (change.basePrice !== undefined) permissions.add("prices_stocks.update_price");
        if (change.sellableStock !== undefined) permissions.add("prices_stocks.update_stock");
        if (change.minNights !== undefined) permissions.add("prices_stocks.manage_minimum_night");
        if (change.stopSell !== undefined) permissions.add("prices_stocks.manage_stop_sell");
      }
      for (const permission of permissions) {
        await app.requirePermission(permission)(request, reply);
        if (reply.sent) return;
      }

      const { roomType, stockLimit } = await getRoomTypeAndStockLimit(app, roomTypeId);
      if (!roomType) return reply.code(404).send(errorBody("NOT_FOUND", "Room type not found"));
      if (!roomType.isActive)
        return reply.code(409).send(errorBody("ROOM_TYPE_INACTIVE", "Room type is inactive"));
      if (
        changes.some(
          (change) => change.sellableStock !== undefined && change.sellableStock > stockLimit,
        )
      ) {
        return reply
          .code(400)
          .send(
            errorBody(
              "STOCK_EXCEEDS_ROOMS",
              `Sellable stock cannot exceed ${stockLimit} active rooms`,
            ),
          );
      }

      try {
        const updated = await app.db.transaction(async (tx) => {
          const existing = await tx
            .select()
            .from(roomInventoryDaily)
            .where(
              and(
                eq(roomInventoryDaily.roomTypeId, roomTypeId),
                inArray(roomInventoryDaily.stayDate, dates),
              ),
            )
            .for("update");
          const byDate = new Map(existing.map((row) => [row.stayDate, row]));

          for (const change of changes) {
            const previous = byDate.get(change.stayDate);
            if ((previous?.version ?? null) !== change.expectedVersion) {
              throw new InventoryConflict(
                `Inventory changed for ${change.stayDate}; reload before saving`,
              );
            }
          }

          const newRows = changes.filter((change) => change.expectedVersion === null);
          const incomplete = newRows.find(
            (change) => change.basePrice === undefined || change.sellableStock === undefined,
          );
          if (incomplete) {
            throw new InventoryIncomplete(
              `New date ${incomplete.stayDate} requires both basePrice and sellableStock`,
            );
          }
          if (newRows.length) {
            const inserted = await tx
              .insert(roomInventoryDaily)
              .values(
                newRows.map((change) => ({
                  roomTypeId,
                  stayDate: change.stayDate,
                  basePrice: change.basePrice!,
                  sellableStock: change.sellableStock!,
                  minNights: change.minNights ?? 1,
                  stopSell: change.stopSell ?? false,
                })),
              )
              .onConflictDoNothing()
              .returning({ id: roomInventoryDaily.id });
            if (inserted.length !== newRows.length) {
              throw new InventoryConflict(
                "Inventory was created by another request; reload before saving",
              );
            }
          }

          const existingChanges = changes.filter((change) => change.expectedVersion !== null);
          for (const change of existingChanges) {
            const values = {
              ...(change.basePrice !== undefined ? { basePrice: change.basePrice } : {}),
              ...(change.sellableStock !== undefined
                ? { sellableStock: change.sellableStock }
                : {}),
              ...(change.minNights !== undefined ? { minNights: change.minNights } : {}),
              ...(change.stopSell !== undefined ? { stopSell: change.stopSell } : {}),
              version: sql`${roomInventoryDaily.version} + 1`,
              updatedAt: new Date(),
            };
            const [saved] = await tx
              .update(roomInventoryDaily)
              .set(values)
              .where(
                and(
                  eq(roomInventoryDaily.roomTypeId, roomTypeId),
                  eq(roomInventoryDaily.stayDate, change.stayDate),
                  eq(roomInventoryDaily.version, change.expectedVersion!),
                ),
              )
              .returning({ id: roomInventoryDaily.id });
            if (!saved)
              throw new InventoryConflict(
                `Inventory changed for ${change.stayDate}; reload before saving`,
              );
          }
          return changes.length;
        });
        return { updated };
      } catch (error) {
        if (error instanceof InventoryConflict) {
          return reply.code(409).send(errorBody("VERSION_CONFLICT", error.message));
        }
        if (error instanceof InventoryIncomplete) {
          return reply.code(400).send(errorBody("INCOMPLETE_NEW_DATE", error.message));
        }
        throw error;
      }
    },
  );
};
