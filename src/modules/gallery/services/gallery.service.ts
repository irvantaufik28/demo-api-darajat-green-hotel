import { and, asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { galleryImages } from "../../../db/schema/gallery_images.schema.js";
import type { GalleryImageBody, GalleryListQuery } from "../schemas/gallery.schema.js";

export async function listGalleryImages(app: FastifyInstance, query: GalleryListQuery) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 30;
  const filter = and(
    query.category ? eq(galleryImages.category, query.category) : undefined,
    query.isActive === undefined ? undefined : eq(galleryImages.isActive, query.isActive),
    query.homepage === undefined ? undefined : eq(galleryImages.showOnHomepage, query.homepage),
  );

  const [items, [count]] = await Promise.all([
    app.db
      .select()
      .from(galleryImages)
      .where(filter)
      .orderBy(asc(galleryImages.sortOrder), asc(galleryImages.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    app.db
      .select({ total: sql<number>`count(*)::int` })
      .from(galleryImages)
      .where(filter),
  ]);

  return { items, page, limit, total: count.total };
}

export async function getGalleryImage(app: FastifyInstance, id: string) {
  const [image] = await app.db
    .select()
    .from(galleryImages)
    .where(eq(galleryImages.id, id))
    .limit(1);
  return image;
}

export async function createGalleryImage(app: FastifyInstance, body: GalleryImageBody) {
  const [image] = await app.db
    .insert(galleryImages)
    .values({
      ...body,
      imageUrl: body.imageUrl.trim(),
      altTextId: body.altTextId.trim(),
      altTextEn: body.altTextEn.trim(),
    })
    .returning();
  return image;
}

export async function updateGalleryImage(
  app: FastifyInstance,
  id: string,
  body: Partial<GalleryImageBody>,
) {
  const [image] = await app.db
    .update(galleryImages)
    .set({
      ...body,
      ...(body.imageUrl !== undefined ? { imageUrl: body.imageUrl.trim() } : {}),
      ...(body.altTextId !== undefined ? { altTextId: body.altTextId.trim() } : {}),
      ...(body.altTextEn !== undefined ? { altTextEn: body.altTextEn.trim() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(galleryImages.id, id))
    .returning();
  return image;
}

export async function deleteGalleryImage(app: FastifyInstance, id: string) {
  const [image] = await app.db
    .delete(galleryImages)
    .where(eq(galleryImages.id, id))
    .returning({ id: galleryImages.id });
  return image;
}
