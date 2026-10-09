import type { FastifyPluginAsync } from "fastify";
import {
  publicReservationLookupBodySchema,
  type PublicReservationLookupBody,
} from "../schemas/public-reservation-lookup.schema.js";
import { renderPublicReservationDocument } from "../services/public-reservation-document.service.js";
import {
  findPublicReservationByContact,
  lookupPublicReservation,
} from "../services/public-reservation-lookup.service.js";
import { getPublicReservationPaymentStatus } from "../services/public-reservation-payment-status.service.js";

export const publicReservationLookupRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: PublicReservationLookupBody }>(
    "/lookup",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { body: publicReservationLookupBodySchema },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const result = await lookupPublicReservation(
        app.db,
        request.body.bookingCode,
        request.body.contactInfo,
      );
      if (!result) {
        return reply.code(404).send({
          error: {
            code: "RESERVATION_NOT_FOUND",
            message: "Reservation was not found for the supplied booking code and contact",
          },
        });
      }
      return reply.send(result);
    },
  );

  app.post<{ Params: { type: string }; Body: PublicReservationLookupBody }>(
    "/lookup/documents/:type",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        params: {
          type: "object",
          required: ["type"],
          properties: { type: { type: "string", enum: ["voucher", "receipt"] } },
        },
        body: publicReservationLookupBodySchema,
      },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const record = await findPublicReservationByContact(
        app.db,
        request.body.bookingCode,
        request.body.contactInfo,
      );
      if (!record) {
        return reply.code(404).send({
          error: {
            code: "RESERVATION_NOT_FOUND",
            message: "Reservation was not found for the supplied booking code and contact",
          },
        });
      }

      const status = await getPublicReservationPaymentStatus(app.db, record.reservation.id);
      const type = request.params.type as "voucher" | "receipt";
      if (
        !status ||
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

      const pdf = await renderPublicReservationDocument(
        app.db,
        record.reservation.id,
        type,
        status,
      );
      if (!pdf) {
        return reply.code(404).send({
          error: { code: "RESERVATION_NOT_FOUND", message: "Reservation not found" },
        });
      }
      return reply
        .header("Content-Type", "application/pdf")
        .header(
          "Content-Disposition",
          `attachment; filename="${record.reservation.bookingCode}-${type}.pdf"`,
        )
        .send(pdf);
    },
  );
};
