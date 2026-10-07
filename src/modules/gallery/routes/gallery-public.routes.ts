import type { FastifyPluginAsync } from "fastify";
import { galleryPublicQuerySchema, type GalleryListQuery } from "../schemas/gallery.schema.js";
import { listGalleryImages } from "../services/gallery.service.js";

export const galleryPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: GalleryListQuery }>(
    "/",
    { schema: { querystring: galleryPublicQuerySchema } },
    async (request) => {
      const result = await listGalleryImages(app, { ...request.query, isActive: true });
      return {
        ...result,
        items: result.items.map(({ cloudinaryPublicId, ...image }) => image),
      };
    },
  );
};
