import { timingSafeEqual } from "node:crypto";
import { createCheckoutToken } from "../reservation-checkout-token.js";
import type { FastifyPluginAsync } from "fastify";
import {
  publicReservationCreateBodySchema,
  type PublicReservationCreateBody,
} from "../schemas/public-reservation-create.schema.js";
import {
  createPublicReservation,
  InvalidPromoCodeError,
  PublicReservationCreateError,
  PublicRoomQuoteError,
  ReservationTotalError,
} from "../services/public-reservation-create.service.js";
import { expireDueWebsiteReservations } from "../services/public-reservation-expiry.service.js";

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export const publicReservationCreateRoutes: FastifyPluginAsync = async (app) => {
  app.get("/expire-due", async (request, reply) => {
    const secret = process.env.CRON_SECRET;
    if (!secret)
      return reply.code(503).send(errorBody("CRON_NOT_CONFIGURED", "Expiry job is not configured"));
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(request.headers.authorization ?? "");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return reply.code(401).send(errorBody("UNAUTHORIZED", "Invalid job authorization"));
    }
    const expired = await expireDueWebsiteReservations(app.db);
    return { expired, hasMore: expired === 100 };
  });

  app.post<{ Body: PublicReservationCreateBody }>(
    "/",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { body: publicReservationCreateBodySchema },
    },
    async (request, reply) => {
      try {
        await expireDueWebsiteReservations(app.db);
        const result = await createPublicReservation(app.db, request.body);
        const reservation = result.reservation as Record<string, unknown> & { id: string };
        return reply.code(result.replayed ? 200 : 201).send({
          ...reservation,
          checkoutToken: createCheckoutToken(reservation.id, app.authConfig.jwtSecret),
        });
      } catch (error) {
        if (
          error instanceof PublicReservationCreateError ||
          error instanceof PublicRoomQuoteError
        ) {
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
};
