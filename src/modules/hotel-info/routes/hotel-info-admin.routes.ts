import type { FastifyPluginAsync } from "fastify";
import { databaseErrorCode } from "../../master/master.shared.js";
import {
  facilityBodySchema,
  facilityParamsSchema,
  facilityUpdateSchema,
  hotelInfoBodySchema,
  type FacilityBody,
  type HotelInfoBody,
} from "../schemas/hotel-info.schema.js";
import {
  createHotelFacility,
  deleteHotelFacility,
  getHotelInfo,
  saveHotelInfo,
  updateHotelFacility,
} from "../services/hotel-info.service.js";

type FacilityParams = { id: string };

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export const hotelInfoAdminRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.requirePermission("web_settings.manage") }, async () => ({
    data: await getHotelInfo(app, true),
  }));

  app.put<{ Body: HotelInfoBody }>(
    "/",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { body: hotelInfoBodySchema },
    },
    async (request, reply) => {
      if ((request.body.latitude == null) !== (request.body.longitude == null)) {
        return reply
          .code(400)
          .send(
            errorBody("INVALID_COORDINATES", "Latitude and longitude must be provided together"),
          );
      }
      if (
        !request.body.name.trim() ||
        !request.body.address.trim() ||
        !request.body.city.trim() ||
        !request.body.province.trim()
      ) {
        return reply
          .code(400)
          .send(errorBody("INVALID_HOTEL_INFO", "Required text fields cannot be blank"));
      }
      await saveHotelInfo(app, request.body);
      return { data: await getHotelInfo(app, true) };
    },
  );

  app.post<{ Body: FacilityBody }>(
    "/facilities",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { body: facilityBodySchema },
    },
    async (request, reply) => {
      if (!request.body.name.trim()) {
        return reply.code(400).send(errorBody("INVALID_FACILITY", "Name cannot be blank"));
      }
      try {
        return reply.code(201).send({ facility: await createHotelFacility(app, request.body) });
      } catch (error) {
        if (databaseErrorCode(error) === "23503") {
          return reply.code(409).send(errorBody("HOTEL_INFO_REQUIRED", "Save hotel info first"));
        }
        if (databaseErrorCode(error) === "23505") {
          return reply.code(409).send(errorBody("DUPLICATE_FACILITY", "Facility already exists"));
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: FacilityParams; Body: Partial<FacilityBody> }>(
    "/facilities/:id",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { params: facilityParamsSchema, body: facilityUpdateSchema },
    },
    async (request, reply) => {
      if (request.body.name !== undefined && !request.body.name.trim()) {
        return reply.code(400).send(errorBody("INVALID_FACILITY", "Name cannot be blank"));
      }
      try {
        const facility = await updateHotelFacility(app, request.params.id, request.body);
        if (!facility) return reply.code(404).send(errorBody("NOT_FOUND", "Facility not found"));
        return { facility };
      } catch (error) {
        if (databaseErrorCode(error) === "23505") {
          return reply.code(409).send(errorBody("DUPLICATE_FACILITY", "Facility already exists"));
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: FacilityParams }>(
    "/facilities/:id",
    {
      preHandler: app.requirePermission("web_settings.manage"),
      schema: { params: facilityParamsSchema },
    },
    async (request, reply) => {
      const facility = await deleteHotelFacility(app, request.params.id);
      if (!facility) return reply.code(404).send(errorBody("NOT_FOUND", "Facility not found"));
      return reply.code(204).send();
    },
  );
};
