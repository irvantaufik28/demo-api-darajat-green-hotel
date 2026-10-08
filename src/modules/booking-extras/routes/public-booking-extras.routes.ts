import type { FastifyPluginAsync } from "fastify";
import {
  publicBookingExtrasQuerySchema,
  type PublicBookingExtrasQuery,
} from "../schemas/public-booking-extras.schema.js";
import {
  listPublicBookingExtras,
  PublicBookingExtrasError,
} from "../services/public-booking-extras.service.js";

export const publicBookingExtrasRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: PublicBookingExtrasQuery }>(
    "/extras",
    { schema: { querystring: publicBookingExtrasQuerySchema } },
    async (request, reply) => {
      try {
        return await listPublicBookingExtras(app.db, request.query);
      } catch (error) {
        if (error instanceof PublicBookingExtrasError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );
};
