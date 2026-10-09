import type { FastifyPluginAsync } from "fastify";
import {
  getReservationsReport,
  type ReservationReportDateBy,
  type ReservationReportSort,
  type ReservationReportSource,
} from "../services/reservations-report.service.js";
import type { ReservationStatus } from "../../reservations/reservation-status.js";

type ReportQuery = {
  search?: string;
  dateBy?: ReservationReportDateBy;
  from?: string;
  to?: string;
  reservationStatus?: ReservationStatus;
  source?: ReservationReportSource;
  roomType?: string;
  otaChannelId?: string;
  sort?: ReservationReportSort;
  page?: number;
  limit?: number;
};

const querySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    search: { type: "string", maxLength: 255 },
    dateBy: { type: "string", enum: ["booking", "check_in", "check_out"], default: "booking" },
    from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    to: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    reservationStatus: {
      type: "string",
      enum: [
        "pending",
        "confirmed",
        "checked_in",
        "checked_out",
        "no_show",
        "cancelled",
        "expired",
      ],
    },
    source: { type: "string", enum: ["website", "phone", "walk_in", "ota"] },
    roomType: { type: "string", format: "uuid" },
    otaChannelId: { type: "string", format: "uuid" },
    sort: {
      type: "string",
      enum: ["newest", "booking_code_asc", "booking_code_desc"],
      default: "newest",
    },
    page: { type: "integer", minimum: 1, default: 1 },
    // A high ceiling supports CSV export of the whole filtered set in one request.
    limit: { type: "integer", minimum: 1, maximum: 1000, default: 20 },
  },
} as const;

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const reservationsReportRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ReportQuery }>(
    "/reservations",
    {
      preHandler: app.requirePermission("reports.view_reservations"),
      schema: { querystring: querySchema },
    },
    async (request, reply) => {
      const {
        search,
        dateBy = "booking",
        from,
        to,
        reservationStatus,
        source,
        roomType,
        otaChannelId,
        sort = "newest",
        page = 1,
        limit = 20,
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

      return getReservationsReport(
        app.db,
        { search, dateBy, from, to, reservationStatus, source, roomType, otaChannelId, sort },
        { page, limit },
      );
    },
  );
};
