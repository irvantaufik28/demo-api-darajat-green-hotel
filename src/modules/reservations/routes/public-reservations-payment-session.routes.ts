import type { FastifyPluginAsync } from "fastify";
import { verifyCheckoutToken } from "../reservation-checkout-token.js";
import {
  CheckoutSessionError,
  createWebsitePaymentSession,
} from "../services/xendit-payment-session.service.js";

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
} as const;

export const publicReservationPaymentSessionRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>(
    "/:id/payment-session",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { params: paramsSchema },
    },
    async (request, reply) => {
      const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
      if (!verifyCheckoutToken(request.params.id, token, app.authConfig.jwtSecret)) {
        return reply
          .code(401)
          .send({ error: { code: "UNAUTHORIZED", message: "Invalid checkout token" } });
      }
      if (!app.authConfig.xendit) {
        return reply
          .code(503)
          .send({
            error: { code: "XENDIT_NOT_CONFIGURED", message: "Website payment is not configured" },
          });
      }
      try {
        const result = await createWebsitePaymentSession(
          app.db,
          request.params.id,
          app.authConfig.xendit,
        );
        return reply
          .code(result.status === "creating" ? 202 : result.replayed ? 200 : 201)
          .send(result);
      } catch (error) {
        if (error instanceof CheckoutSessionError) {
          return reply
            .code(error.statusCode)
            .send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );
};
