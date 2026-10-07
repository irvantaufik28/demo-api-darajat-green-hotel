import type { FastifyPluginAsync } from "fastify";
import { getHotelInfo } from "../services/hotel-info.service.js";

export const hotelInfoPublicRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (_request, reply) => {
    const data = await getHotelInfo(app);
    if (!data) {
      return reply.code(404).send({
        error: { code: "HOTEL_INFO_NOT_CONFIGURED", message: "Hotel info is not configured" },
      });
    }

    const { logoPublicId, faviconPublicId, ...hotel } = data.hotel;
    return {
      hotel,
      facilities: data.facilities.map(({ hotelId, ...facility }) => facility),
    };
  });
};
