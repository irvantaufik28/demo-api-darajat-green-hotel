import type { FastifyPluginAsync } from "fastify";
import { verifyCheckoutToken } from "../reservation-checkout-token.js";
import { getPublicReservationPaymentStatus } from "../services/public-reservation-payment-status.service.js";

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

export const publicReservationPaymentStatusRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    "/:id/payment-status",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: { params: paramsSchema },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
      if (!verifyCheckoutToken(request.params.id, token, app.authConfig.jwtSecret)) {
        return reply.code(401).send({
          error: { code: "UNAUTHORIZED", message: "Invalid checkout token" },
        });
      }

      const result = await getPublicReservationPaymentStatus(app.db, request.params.id);
      if (!result) {
        return reply.code(404).send({
          error: { code: "RESERVATION_NOT_FOUND", message: "Website reservation not found" },
        });
      }
      return reply.send(result);
    },
  );
};
