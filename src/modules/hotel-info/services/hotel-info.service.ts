import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { hotelFacilities } from "../../../db/schema/hotel_facilities.schema.js";
import { hotelInfo } from "../../../db/schema/hotel_info.schema.js";
import type { FacilityBody, HotelInfoBody } from "../schemas/hotel-info.schema.js";

const hotelId = 1;

export async function getHotelInfo(app: FastifyInstance, includeInactive = false) {
  const [hotel] = await app.db.select().from(hotelInfo).where(eq(hotelInfo.id, hotelId)).limit(1);
  if (!hotel) return null;

  const facilities = await app.db
    .select()
    .from(hotelFacilities)
    .where(
      includeInactive
        ? eq(hotelFacilities.hotelId, hotelId)
        : and(eq(hotelFacilities.hotelId, hotelId), eq(hotelFacilities.isActive, true)),
    )
    .orderBy(asc(hotelFacilities.sortOrder), asc(hotelFacilities.name));

  return { hotel, facilities };
}

export async function saveHotelInfo(app: FastifyInstance, body: HotelInfoBody) {
  const [hotel] = await app.db
    .insert(hotelInfo)
    .values({
      ...hotelValues(body),
      id: hotelId,
    })
    .onConflictDoUpdate({
      target: hotelInfo.id,
      set: { ...hotelValues(body), updatedAt: new Date() },
    })
    .returning();
  return hotel;
}

function hotelValues(body: HotelInfoBody) {
  return {
    name: body.name.trim(),
    shortDescription: body.shortDescription ?? null,
    description: body.description ?? null,
    address: body.address.trim(),
    district: body.district ?? null,
    city: body.city.trim(),
    province: body.province.trim(),
    postalCode: body.postalCode ?? null,
    googleMapsUrl: body.googleMapsUrl ?? null,
    latitude: body.latitude == null ? null : String(body.latitude),
    longitude: body.longitude == null ? null : String(body.longitude),
    phone: body.phone ?? null,
    whatsappNumber: body.whatsappNumber ?? null,
    email: body.email ?? null,
    logoUrl: body.logoUrl ?? null,
    logoPublicId: body.logoPublicId ?? null,
    faviconUrl: body.faviconUrl ?? null,
    faviconPublicId: body.faviconPublicId ?? null,
  };
}

export async function createHotelFacility(app: FastifyInstance, body: FacilityBody) {
  const [facility] = await app.db
    .insert(hotelFacilities)
    .values({
      hotelId,
      name: body.name.trim(),
      kind: body.kind,
      description: body.description ?? null,
      sortOrder: body.sortOrder ?? 0,
      isActive: body.isActive ?? true,
    })
    .returning();
  return facility;
}

export async function updateHotelFacility(
  app: FastifyInstance,
  id: string,
  body: Partial<FacilityBody>,
) {
  const [facility] = await app.db
    .update(hotelFacilities)
    .set({
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.kind !== undefined ? { kind: body.kind } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(hotelFacilities.id, id), eq(hotelFacilities.hotelId, hotelId)))
    .returning();
  return facility;
}

export async function deleteHotelFacility(app: FastifyInstance, id: string) {
  const [facility] = await app.db
    .delete(hotelFacilities)
    .where(and(eq(hotelFacilities.id, id), eq(hotelFacilities.hotelId, hotelId)))
    .returning({ id: hotelFacilities.id });
  return facility;
}
