import { and, count, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { roomInventoryDaily } from "../../db/schema/room_inventory_daily.schema.js";
import { roomTypes } from "../../db/schema/room_types.schema.js";
import { roomUnits } from "../../db/schema/room_units.schema.js";
import {
  inventoryBulkBodySchema,
  inventoryListQuerySchema,
  type BulkInventoryBody,
  type InventoryChange,
} from "./prices-stocks.schemas.js";

type ListQuery = {
  roomTypeId: string;
  startDate: string;
  endDate: string;
  page?: number;
  limit?: number;
};

const errorBody = (code: string, message: string) => ({ error: { code, message } });

class InventoryConflict extends Error {}

function parseStayDate(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
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
  const [[roomType], [stock]] = await Promise.all([
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
  ]);
  return { roomType, stockLimit: stock.total };
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
      const { roomType, stockLimit } = await getRoomTypeAndStockLimit(app, roomTypeId);
      if (!roomType) return reply.code(404).send(errorBody("NOT_FOUND", "Room type not found"));

      const visibleDates = dates.slice((page - 1) * limit, page * limit);
      const configured = visibleDates.length
        ? await app.db
            .select()
            .from(roomInventoryDaily)
            .where(
              and(
                eq(roomInventoryDaily.roomTypeId, roomTypeId),
                gte(roomInventoryDaily.stayDate, visibleDates[0]),
                lte(roomInventoryDaily.stayDate, visibleDates[visibleDates.length - 1]),
              ),
            )
        : [];
      const byDate = new Map(configured.map((row) => [row.stayDate, row]));
      const items = visibleDates.map((stayDate) => {
        const row = byDate.get(stayDate);
        return row
          ? { ...row, isConfigured: true }
          : {
              id: null,
              roomTypeId,
              stayDate,
              basePrice: roomType.basePricePerNight,
              sellableStock: stockLimit,
              minNights: 1,
              stopSell: false,
              version: null,
              isConfigured: false,
            };
      });
      return { roomType, stockLimit, items, page, limit, total: dates.length };
    },
  );

  app.put<{ Body: BulkInventoryBody }>(
    "/bulk",
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
          if (newRows.length) {
            const inserted = await tx
              .insert(roomInventoryDaily)
              .values(
                newRows.map((change) => ({
                  roomTypeId,
                  stayDate: change.stayDate,
                  basePrice: change.basePrice ?? roomType.basePricePerNight,
                  sellableStock: change.sellableStock ?? stockLimit,
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
        throw error;
      }
    },
  );
};
