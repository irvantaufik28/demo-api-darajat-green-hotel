import type { FastifyPluginAsync } from "fastify";
import {
  getRevenueReport,
  type RevenueReportDateBy,
  type RevenueReportSource,
} from "../services/revenue-report.service.js";
import type {
  ReservationPaymentStatus,
  ReservationStatus,
} from "../../reservations/reservation-status.js";

type RevenueQuery = {
  dateBy?: RevenueReportDateBy;
  from?: string;
  to?: string;
  source?: RevenueReportSource;
  paymentStatus?: ReservationPaymentStatus;
  reservationStatus?: ReservationStatus;
  methodId?: string;
  roomType?: string;
};

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    dateBy: { type: "string", enum: ["payment", "booking", "check_in"], default: "booking" },
    from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    source: { type: "string", enum: ["website", "phone", "walk_in", "ota"] },
    paymentStatus: {
      type: "string",
      enum: ["unpaid", "partial", "paid", "failed", "expired", "refunded"],
    },
    reservationStatus: {
      type: "string",
      enum: ["pending", "confirmed", "checked_in", "checked_out", "cancelled", "expired"],
    },
    methodId: { type: "string", format: "uuid" },
    roomType: { type: "string", format: "uuid" },
  },
} as const;

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const revenueReportRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: RevenueQuery }>(
    "/revenue",
    {
      preHandler: app.requirePermission("reports.view_revenue"),
      schema: { querystring: querySchema },
    },
    async (request, reply) => {
      const {
        dateBy = "booking",
        from,
        to,
        source,
        paymentStatus,
        reservationStatus,
        methodId,
        roomType,
      } = request.query;

      if (from && !validDate(from)) {
        return reply
          .code(400)
          .send({ error: { code: "INVALID_FROM_DATE", message: "From date is invalid" } });
      }
      if (to && !validDate(to)) {
        return reply
          .code(400)
          .send({ error: { code: "INVALID_TO_DATE", message: "To date is invalid" } });
      }
      if (from && to && from > to) {
        return reply.code(400).send({
          error: { code: "INVALID_DATE_RANGE", message: "From date must not be after To date" },
        });
      }

      return getRevenueReport(app.db, {
        dateBy,
        from,
        to,
        source,
        paymentStatus,
        reservationStatus,
        methodId,
        roomType,
      });
    },
  );
};
