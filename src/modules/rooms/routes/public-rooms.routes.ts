import type { FastifyPluginAsync } from "fastify";
import { InvalidPromoCodeError } from "../../reservations/services/reservations-campaigns.service.js";
import { ReservationTotalError } from "../../reservations/services/reservation-total.service.js";
import { expireDueWebsiteReservations } from "../../reservations/services/public-reservation-expiry.service.js";
import {
  publicRoomQuoteBodySchema,
  type PublicRoomQuoteBody,
} from "../schemas/public-room-quote.schema.js";
import {
  publicRoomAvailabilityQuerySchema,
  publicRoomSlugParamsSchema,
} from "../schemas/public-rooms.schema.js";
import {
  searchPublicRoomAvailability,
  type PublicRoomAvailabilityQuery,
} from "../services/public-room-availability.service.js";
import { listPublicRooms } from "../services/public-rooms.service.js";
import { PublicRoomQuoteError, quotePublicRooms } from "../services/public-room-quote.service.js";

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export const publicRoomsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async () => ({ items: await listPublicRooms(app.db) }));

  app.get<{ Querystring: PublicRoomAvailabilityQuery }>(
    "/availability",
    { schema: { querystring: publicRoomAvailabilityQuerySchema } },
    async (request, reply) => {
      try {
        await expireDueWebsiteReservations(app.db);
        return await searchPublicRoomAvailability(app.db, request.query);
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_STAY_DATES") {
          return reply
            .code(400)
            .send(
              errorBody("INVALID_STAY_DATES", "Use dates from today for a stay of 1 to 366 nights"),
            );
        }
        if (error instanceof Error && error.message === "INVALID_GUEST_COUNT") {
          return reply
            .code(400)
            .send(errorBody("INVALID_GUEST_COUNT", "Provide both adults and children"));
        }
        throw error;
      }
    },
  );

  app.post<{ Body: PublicRoomQuoteBody }>(
    "/quote",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { body: publicRoomQuoteBodySchema },
    },
    async (request, reply) => {
      try {
        await expireDueWebsiteReservations(app.db);
        return await quotePublicRooms(app.db, request.body);
      } catch (error) {
        if (error instanceof PublicRoomQuoteError) {
          return reply.code(error.statusCode).send(errorBody(error.code, error.message));
        }
        if (error instanceof InvalidPromoCodeError) {
          return reply.code(400).send(errorBody("INVALID_PROMO_CODE", error.message));
        }
        if (error instanceof ReservationTotalError) {
          return reply.code(400).send(errorBody(error.code, error.message));
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { slug: string } }>(
    "/:slug",
    { schema: { params: publicRoomSlugParamsSchema } },
    async (request, reply) => {
      const [roomType] = await listPublicRooms(app.db, request.params.slug);
      if (!roomType) return reply.code(404).send(errorBody("NOT_FOUND", "Room type not found"));
      return { roomType };
    },
  );
};
