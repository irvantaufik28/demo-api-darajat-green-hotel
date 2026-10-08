import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { capacityPatterns } from "../../../db/schema/capacity_patterns.schema.js";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { roomTypeAmenities } from "../../../db/schema/room_type_amenities.schema.js";
import { roomTypeCapacityPatterns } from "../../../db/schema/room_type_capacity_patterns.schema.js";
import { roomTypeImages } from "../../../db/schema/room_type_images.schema.js";
import { roomTypes } from "../../../db/schema/room_types.schema.js";

export async function listPublicRooms(db: Database, slug?: string) {
  const types = await db
    .select()
    .from(roomTypes)
    .where(and(eq(roomTypes.isActive, true), slug ? eq(roomTypes.slug, slug) : undefined))
    .orderBy(asc(roomTypes.name));

  const ids = types.map((type) => type.id);
  if (!ids.length) return [];

  const masterIds = [
    ...new Set(
      types
        .flatMap((type) => [type.bedTypeId, type.mealTypeId, type.viewTypeId])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [images, amenities, capacities, names] = await Promise.all([
    db
      .select()
      .from(roomTypeImages)
      .where(inArray(roomTypeImages.roomTypeId, ids))
      .orderBy(asc(roomTypeImages.sortOrder)),
    db
      .select({
        roomTypeId: roomTypeAmenities.roomTypeId,
        id: masterItems.id,
        name: masterItems.name,
        iconKey: masterItems.iconKey,
      })
      .from(roomTypeAmenities)
      .innerJoin(masterItems, eq(roomTypeAmenities.amenityId, masterItems.id))
      .where(and(inArray(roomTypeAmenities.roomTypeId, ids), eq(masterItems.isActive, true)))
      .orderBy(asc(masterItems.sortOrder), asc(masterItems.name)),
    db
      .select({
        roomTypeId: roomTypeCapacityPatterns.roomTypeId,
        adults: capacityPatterns.adults,
        children: capacityPatterns.children,
        extraBeds: roomTypeCapacityPatterns.extraBeds,
      })
      .from(roomTypeCapacityPatterns)
      .innerJoin(
        capacityPatterns,
        eq(roomTypeCapacityPatterns.capacityPatternId, capacityPatterns.id),
      )
      .where(
        and(inArray(roomTypeCapacityPatterns.roomTypeId, ids), eq(capacityPatterns.isActive, true)),
      ),
    masterIds.length
      ? db
          .select({ id: masterItems.id, name: masterItems.name })
          .from(masterItems)
          .where(inArray(masterItems.id, masterIds))
      : Promise.resolve([]),
  ]);

  const namesById = new Map(names.map((item) => [item.id, item.name]));
  return types.map((type) => ({
    id: type.id,
    slug: type.slug,
    name: type.name,
    description: type.description,
    sizeSqm: type.sizeSqm,
    bedCount: type.bedCount,
    bedTypeName: type.bedTypeId ? (namesById.get(type.bedTypeId) ?? null) : null,
    mealTypeName: type.mealTypeId ? (namesById.get(type.mealTypeId) ?? null) : null,
    viewTypeName: type.viewTypeId ? (namesById.get(type.viewTypeId) ?? null) : null,
    extraBedEnabled: type.extraBedEnabled,
    maxExtraBeds: type.maxExtraBeds,
    images: images
      .filter((image) => image.roomTypeId === type.id)
      .map((image) => ({
        id: image.id,
        url: image.url,
        altText: image.altText,
        isCover: image.isCover,
        sortOrder: image.sortOrder,
      })),
    amenities: amenities
      .filter((item) => item.roomTypeId === type.id)
      .map(({ id, name, iconKey }) => ({ id, name, iconKey })),
    capacityPatterns: capacities
      .filter((item) => item.roomTypeId === type.id)
      .map(({ adults, children, extraBeds }) => ({ adults, children, extraBeds })),
    // An undated catalog must not imply that a nightly rate or stock is configured.
    startingPrice: null,
    availableRooms: null,
  }));
}
