import type { FastifyPluginAsync } from "fastify";
import { verifyCheckoutToken } from "../reservation-checkout-token.js";
import { renderPublicReservationDocument } from "../services/public-reservation-document.service.js";
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

  app.get<{ Params: { id: string; type: string } }>(
    "/:id/documents/:type",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: {
        params: {
          type: "object",
          required: ["id", "type"],
          properties: {
            id: { type: "string", format: "uuid" },
            type: { type: "string", enum: ["voucher", "receipt"] },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1] ?? "";
      if (!verifyCheckoutToken(request.params.id, token, app.authConfig.jwtSecret)) {
        return reply.code(401).send({
          error: { code: "UNAUTHORIZED", message: "Invalid checkout token" },
        });
      }
      const status = await getPublicReservationPaymentStatus(app.db, request.params.id);
      if (!status) {
        return reply.code(404).send({
          error: { code: "RESERVATION_NOT_FOUND", message: "Website reservation not found" },
        });
      }
      const type = request.params.type as "voucher" | "receipt";
      if (
        status.paidAmount <= 0 ||
        (type === "voucher" &&
          !["confirmed", "checked_in", "checked_out"].includes(status.reservationStatus))
      ) {
        return reply.code(409).send({
          error: {
            code: "DOCUMENT_NOT_READY",
            message:
              type === "voucher"
                ? "Voucher is available after reservation confirmation"
                : "No completed payment is recorded",
          },
        });
      }
      const pdf = await renderPublicReservationDocument(app.db, request.params.id, type, status);
      if (!pdf)
        return reply
          .code(404)
          .send({
            error: { code: "RESERVATION_NOT_FOUND", message: "Website reservation not found" },
          });
      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Disposition", `attachment; filename="${status.bookingCode}-${type}.pdf"`)
        .send(pdf);
    },
  );
};
