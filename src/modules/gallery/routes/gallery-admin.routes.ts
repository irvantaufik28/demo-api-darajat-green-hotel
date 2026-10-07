import type { FastifyPluginAsync } from "fastify";
import {
  galleryAdminQuerySchema,
  galleryImageBodySchema,
  galleryImageParamsSchema,
  galleryImageUpdateSchema,
  type GalleryImageBody,
  type GalleryListQuery,
} from "../schemas/gallery.schema.js";
import {
  createGalleryImage,
  deleteGalleryImage,
  getGalleryImage,
  listGalleryImages,
  updateGalleryImage,
} from "../services/gallery.service.js";

type IdParams = { id: string };
const errorBody = (code: string, message: string) => ({ error: { code, message } });

function hasBlankRequiredText(body: Partial<GalleryImageBody>) {
  return [body.imageUrl, body.altTextId, body.altTextEn].some(
    (value) => value !== undefined && !value.trim(),
  );
}

export const galleryAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: GalleryListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { querystring: galleryAdminQuerySchema },
    },
    async (request) => listGalleryImages(app, request.query),
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { params: galleryImageParamsSchema },
    },
    async (request, reply) => {
      const image = await getGalleryImage(app, request.params.id);
      if (!image) return reply.code(404).send(errorBody("NOT_FOUND", "Gallery image not found"));
      return { image };
    },
  );

  app.post<{ Body: GalleryImageBody }>(
    "/",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { body: galleryImageBodySchema },
    },
    async (request, reply) => {
      if (hasBlankRequiredText(request.body)) {
        return reply.code(400).send(errorBody("INVALID_IMAGE", "Image and alt text are required"));
      }
      const image = await createGalleryImage(app, request.body);
      return reply.code(201).send({ image });
    },
  );

  app.patch<{ Params: IdParams; Body: Partial<GalleryImageBody> }>(
    "/:id",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { params: galleryImageParamsSchema, body: galleryImageUpdateSchema },
    },
    async (request, reply) => {
      if (hasBlankRequiredText(request.body)) {
        return reply.code(400).send(errorBody("INVALID_IMAGE", "Image and alt text are required"));
      }
      const image = await updateGalleryImage(app, request.params.id, request.body);
      if (!image) return reply.code(404).send(errorBody("NOT_FOUND", "Gallery image not found"));
      return { image };
    },
  );

  app.delete<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { params: galleryImageParamsSchema },
    },
    async (request, reply) => {
      const image = await deleteGalleryImage(app, request.params.id);
      if (!image) return reply.code(404).send(errorBody("NOT_FOUND", "Gallery image not found"));
      return reply.code(204).send();
    },
  );
};
