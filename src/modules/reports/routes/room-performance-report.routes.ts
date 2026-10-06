import type { FastifyPluginAsync } from "fastify";
import {
  getRoomPerformanceReport,
  type RoomPerformanceMode,
  type RoomPerformanceSource,
} from "../services/room-performance-report.service.js";

type RoomPerformanceQuery = {
  from?: string;
  roomType?: string;
  source?: RoomPerformanceSource;
  mode?: RoomPerformanceMode;
};

const querySchema = {
  type: "object",
  additionalProperties: false,
  required: ["from"],
  properties: {
    from: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    roomType: { type: "string", format: "uuid" },
    source: { type: "string", enum: ["website", "phone", "walk_in", "ota"] },
    mode: { type: "string", enum: ["actual", "projected"], default: "actual" },
  },
} as const;

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const roomPerformanceReportRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: RoomPerformanceQuery }>(
    "/room-performance",
    {
      preHandler: app.requirePermission("reports.view_revenue"),
      schema: { querystring: querySchema },
    },
    async (request, reply) => {
      const { from, roomType, source, mode = "actual" } = request.query;

      if (!from || !validDate(from)) {
        return reply
          .code(400)
          .send({ error: { code: "INVALID_WEEK_START", message: "Week start date is invalid" } });
      }

      return getRoomPerformanceReport(app.db, { weekStart: from, roomType, source, mode });
    },
  );
};
