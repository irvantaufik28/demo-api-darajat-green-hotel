import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { capacityPatterns } from "../../../db/schema/capacity_patterns.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { roomTypeAmenities } from "../../../db/schema/room_type_amenities.schema.js";
import { roomTypeCapacityPatterns } from "../../../db/schema/room_type_capacity_patterns.schema.js";
import { roomTypeImages } from "../../../db/schema/room_type_images.schema.js";
import { roomTypes } from "../../../db/schema/room_types.schema.js";
import type { RoomTypeBody } from "../schemas/room-types.schema.js";

export class RoomTypeInputError extends Error {}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function validateRoomTypeReferences(db: Database, body: RoomTypeBody) {
  if (!body.name.trim()) {
    throw new RoomTypeInputError("Room type name is required");
  }
  const references = [
    { id: body.bedTypeId, category: "bed_types" },
    { id: body.mealTypeId, category: "meal_types" },
    { id: body.viewTypeId, category: "room_view_types" },
    ...body.amenityIds.map((id) => ({ id, category: "amenities" })),
  ].filter((item): item is { id: string; category: string } => Boolean(item.id));

  const uniqueIds = [...new Set(references.map((item) => item.id))];
  const found = uniqueIds.length
    ? await db
        .select({ id: masterItems.id, category: masterItems.category })
        .from(masterItems)
        .where(and(inArray(masterItems.id, uniqueIds), eq(masterItems.isActive, true)))
    : [];
  const categoryById = new Map(found.map((item) => [item.id, item.category]));
  if (references.some((item) => categoryById.get(item.id) !== item.category)) {
    throw new RoomTypeInputError("A master item is missing, inactive, or in the wrong category");
  }

  const patternIds = body.capacityPatterns.map((item) => item.capacityPatternId);
  if (new Set(patternIds).size !== patternIds.length) {
    throw new RoomTypeInputError("Capacity patterns must be unique");
  }
  const patterns = await db
    .select({ id: capacityPatterns.id })
    .from(capacityPatterns)
    .where(and(inArray(capacityPatterns.id, patternIds), eq(capacityPatterns.isActive, true)));
  if (patterns.length !== patternIds.length) {
    throw new RoomTypeInputError("A capacity pattern is missing or inactive");
  }
  if (
    !body.extraBedEnabled &&
    (body.maxExtraBeds !== 0 || body.capacityPatterns.some((p) => p.extraBeds > 0))
  ) {
    throw new RoomTypeInputError("Extra beds must be zero when disabled");
  }
  if (body.capacityPatterns.some((item) => item.extraBeds > body.maxExtraBeds)) {
    throw new RoomTypeInputError("A capacity pattern exceeds the room type's extra bed limit");
  }
  if (body.images.filter((image) => image.isCover).length > 1) {
    throw new RoomTypeInputError("Only one cover image is allowed");
  }
}

function roomTypeIdentifiers(name: string) {
  const slug = name.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
  if (!slug) throw new RoomTypeInputError("Room type name must contain letters or numbers");
  return { slug, code: slug.replace(/-/g, "_").toUpperCase().slice(0, 40) };
}

export function roomTypeValues(
  body: RoomTypeBody,
  existing?: { code: string; slug: string; basePricePerNight: number; isActive: boolean },
) {
  const generated = roomTypeIdentifiers(body.name.trim());
  return {
    code: body.code?.trim() || existing?.code || generated.code,
    slug: body.slug?.trim() || existing?.slug || generated.slug,
    name: body.name.trim(),
    description: body.description?.trim() || null,
    sizeSqm: body.sizeSqm ?? null,
    bedTypeId: body.bedTypeId ?? null,
    mealTypeId: body.mealTypeId ?? null,
    viewTypeId: body.viewTypeId ?? null,
    bedCount: body.bedCount,
    extraBedEnabled: body.extraBedEnabled,
    maxExtraBeds: body.maxExtraBeds,
    extraBedPricePerNight: body.extraBedPricePerNight,
    adultBreakfastPrice: body.adultBreakfastPrice,
    childBreakfastPrice: body.childBreakfastPrice,
    basePricePerNight: body.basePricePerNight ?? existing?.basePricePerNight ?? 0,
    isActive: body.isActive ?? existing?.isActive ?? true,
  };
}

export async function getRoomTypeMasterNames(db: Database, ids: (string | null)[]) {
  const uniqueIds = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!uniqueIds.length) return new Map<string, string>();
  const rows = await db.select({ id: masterItems.id, name: masterItems.name })
    .from(masterItems).where(inArray(masterItems.id, uniqueIds));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export async function replaceRoomTypeRelations(
  db: Transaction,
  roomTypeId: string,
  body: RoomTypeBody,
) {
  await db.delete(roomTypeAmenities).where(eq(roomTypeAmenities.roomTypeId, roomTypeId));
  await db
    .delete(roomTypeCapacityPatterns)
    .where(eq(roomTypeCapacityPatterns.roomTypeId, roomTypeId));
  await db.delete(roomTypeImages).where(eq(roomTypeImages.roomTypeId, roomTypeId));

  if (body.amenityIds.length) {
    await db
      .insert(roomTypeAmenities)
      .values(body.amenityIds.map((amenityId) => ({ roomTypeId, amenityId })));
  }
  await db
    .insert(roomTypeCapacityPatterns)
    .values(body.capacityPatterns.map((item) => ({ roomTypeId, ...item })));
  if (body.images.length) {
    await db.insert(roomTypeImages).values(
      body.images.map((image, index) => ({
        roomTypeId,
        url: image.url,
        altText: image.altText ?? null,
        isCover: image.isCover ?? false,
        sortOrder: image.sortOrder ?? index,
      })),
    );
  }
}

export async function getRoomTypeDetail(db: Database, id: string) {
  const [roomType] = await db.select().from(roomTypes).where(eq(roomTypes.id, id)).limit(1);
  if (!roomType) return null;

  const [amenities, capacities, images, masterNames] = await Promise.all([
    db
      .select({ id: masterItems.id, code: masterItems.code, name: masterItems.name })
      .from(roomTypeAmenities)
      .innerJoin(masterItems, eq(roomTypeAmenities.amenityId, masterItems.id))
      .where(eq(roomTypeAmenities.roomTypeId, id))
      .orderBy(asc(masterItems.name)),
    db
      .select({
        capacityPatternId: capacityPatterns.id,
        adults: capacityPatterns.adults,
        children: capacityPatterns.children,
        extraBeds: roomTypeCapacityPatterns.extraBeds,
      })
      .from(roomTypeCapacityPatterns)
      .innerJoin(
        capacityPatterns,
        eq(roomTypeCapacityPatterns.capacityPatternId, capacityPatterns.id),
      )
      .where(eq(roomTypeCapacityPatterns.roomTypeId, id))
      .orderBy(
        asc(capacityPatterns.sortOrder),
        asc(capacityPatterns.adults),
        asc(capacityPatterns.children),
      ),
    db
      .select()
      .from(roomTypeImages)
      .where(eq(roomTypeImages.roomTypeId, id))
      .orderBy(asc(roomTypeImages.sortOrder)),
    getRoomTypeMasterNames(db, [roomType.bedTypeId, roomType.mealTypeId, roomType.viewTypeId]),
  ]);

  return {
    ...roomType,
    bedTypeName: roomType.bedTypeId ? masterNames.get(roomType.bedTypeId) ?? null : null,
    mealTypeName: roomType.mealTypeId ? masterNames.get(roomType.mealTypeId) ?? null : null,
    viewTypeName: roomType.viewTypeId ? masterNames.get(roomType.viewTypeId) ?? null : null,
    amenities,
    capacityPatterns: capacities,
    capacityPatternCount: capacities.length,
    images,
  };
}
