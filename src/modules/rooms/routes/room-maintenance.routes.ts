import type { FastifyPluginAsync } from "fastify";
import {
  createMaintenanceBodySchema,
  maintenanceIdParamsSchema,
  maintenanceListQuerySchema,
  type CreateMaintenanceBody,
  type MaintenanceListQuery,
} from "../schemas/room-maintenance.schema.js";
import {
  cancelMaintenanceBlock,
  createMaintenanceBlock,
  listMaintenanceBlocks,
  maintenanceDates,
  MaintenanceError,
} from "../services/room-maintenance.service.js";

export const roomMaintenanceRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: MaintenanceListQuery }>(
    "/",
    {
      preHandler: app.requirePermission("rooms.view_numbers"),
      schema: { querystring: maintenanceListQuerySchema },
    },
    async (request, reply) => {
      if (!maintenanceDates(request.query.startDate, request.query.endDate)) {
        return reply.code(400).send({
          error: { code: "INVALID_DATE_RANGE", message: "Use a valid range of 1 to 366 nights" },
        });
      }
      return listMaintenanceBlocks(app.db, request.query);
    },
  );

  app.post<{ Body: CreateMaintenanceBody }>(
    "/",
    {
      preHandler: app.requirePermission("rooms.change_operational_status"),
      schema: { body: createMaintenanceBodySchema },
    },
    async (request, reply) => {
      try {
        const created = await app.db.transaction((tx) =>
          createMaintenanceBlock(tx, request.body, request.authUser!.id),
        );
        return reply.code(201).send(created);
      } catch (error) {
        if (error instanceof MaintenanceError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/:id",
    {
      preHandler: app.requirePermission("rooms.change_operational_status"),
      schema: { params: maintenanceIdParamsSchema },
    },
    async (request, reply) => {
      try {
        return await app.db.transaction((tx) =>
          cancelMaintenanceBlock(tx, request.params.id, request.authUser!.id),
        );
      } catch (error) {
        if (error instanceof MaintenanceError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );
};
