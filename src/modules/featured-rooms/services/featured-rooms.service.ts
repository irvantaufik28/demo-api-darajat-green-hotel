import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { capacityPatterns } from "../../../db/schema/capacity_patterns.schema.js";
import { featuredRoomTypes } from "../../../db/schema/featured_room_types.schema.js";
import { roomInventoryDaily } from "../../../db/schema/room_inventory_daily.schema.js";
import { roomTypeCapacityPatterns } from "../../../db/schema/room_type_capacity_patterns.schema.js";
import { roomTypeImages } from "../../../db/schema/room_type_images.schema.js";
import { roomTypes } from "../../../db/schema/room_types.schema.js";
import type { FeaturedRoomsBody } from "../schemas/featured-rooms.schema.js";

export async function listFeaturedRooms(app: FastifyInstance, publicOnly: boolean) {
  const rows = await app.db
    .select({ featured: featuredRoomTypes, roomType: roomTypes, coverImage: roomTypeImages })
    .from(featuredRoomTypes)
    .innerJoin(roomTypes, eq(featuredRoomTypes.roomTypeId, roomTypes.id))
    .leftJoin(
      roomTypeImages,
      and(eq(roomTypeImages.roomTypeId, roomTypes.id), eq(roomTypeImages.isCover, true)),
    )
    .where(
      publicOnly
        ? and(eq(featuredRoomTypes.isActive, true), eq(roomTypes.isActive, true))
        : undefined,
    )
    .orderBy(asc(featuredRoomTypes.sortOrder), asc(roomTypes.name));

  const ids = rows.map(({ roomType }) => roomType.id);
  if (!ids.length) return [];

  const [rates, capacities] = await Promise.all([
    app.db
      .select({
        roomTypeId: roomInventoryDaily.roomTypeId,
        startingPrice: sql<string>`min(${roomInventoryDaily.basePrice})`,
      })
      .from(roomInventoryDaily)
      .where(
        and(
          inArray(roomInventoryDaily.roomTypeId, ids),
          sql`${roomInventoryDaily.stayDate} >= (now() at time zone 'Asia/Jakarta')::date`,
          sql`${roomInventoryDaily.stayDate} < (now() at time zone 'Asia/Jakarta')::date + 30`,
          sql`${roomInventoryDaily.sellableStock} > 0`,
          eq(roomInventoryDaily.stopSell, false),
        ),
      )
      .groupBy(roomInventoryDaily.roomTypeId),
    app.db
      .select({
        roomTypeId: roomTypeCapacityPatterns.roomTypeId,
        maxGuests: sql<number>`max(${capacityPatterns.adults} + ${capacityPatterns.children})::int`,
      })
      .from(roomTypeCapacityPatterns)
      .innerJoin(
        capacityPatterns,
        eq(roomTypeCapacityPatterns.capacityPatternId, capacityPatterns.id),
      )
      .where(
        and(inArray(roomTypeCapacityPatterns.roomTypeId, ids), eq(capacityPatterns.isActive, true)),
      )
      .groupBy(roomTypeCapacityPatterns.roomTypeId),
  ]);

  const priceByType = new Map(rates.map((rate) => [rate.roomTypeId, Number(rate.startingPrice)]));
  const capacityByType = new Map(
    capacities.map((capacity) => [capacity.roomTypeId, capacity.maxGuests]),
  );

  return rows.map(({ featured, roomType, coverImage }) => ({
    roomTypeId: roomType.id,
    sortOrder: featured.sortOrder,
    isActive: featured.isActive,
    slug: roomType.slug,
    name: roomType.name,
    description: roomType.description,
    sizeSqm: roomType.sizeSqm,
    maxGuests: capacityByType.get(roomType.id) ?? null,
    coverImage: coverImage ? { url: coverImage.url, altText: coverImage.altText } : null,
    startingPrice: priceByType.get(roomType.id) ?? null,
    ...(publicOnly ? {} : { roomTypeIsActive: roomType.isActive }),
  }));
}

export async function saveFeaturedRooms(app: FastifyInstance, body: FeaturedRoomsBody) {
  await app.db.transaction(async (tx) => {
    await tx.delete(featuredRoomTypes);
    if (body.items.length) {
      await tx.insert(featuredRoomTypes).values(
        body.items.map((item, sortOrder) => ({
          roomTypeId: item.roomTypeId,
          sortOrder,
          isActive: item.isActive,
        })),
      );
    }
  });
}
