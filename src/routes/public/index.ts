import type { FastifyPluginAsync } from "fastify";
import { xenditWebhookRoutes } from "../../modules/payments/index.js";
import { hotelInfoPublicRoutes } from "../../modules/hotel-info/index.js";
import { featuredRoomsPublicRoutes } from "../../modules/featured-rooms/index.js";
import { galleryPublicRoutes } from "../../modules/gallery/index.js";
import { publicRoomsRoutes } from "../../modules/rooms/index.js";
import { publicBookingExtrasRoutes } from "../../modules/booking-extras/index.js";
import {
  publicReservationCreateRoutes,
  publicReservationPaymentSessionRoutes,
  publicReservationPaymentStatusRoutes,
} from "../../modules/reservations/index.js";

export const publicRoutes: FastifyPluginAsync = async (app) => {
  await app.register(hotelInfoPublicRoutes, { prefix: "/hotel-info" });
  await app.register(featuredRoomsPublicRoutes, { prefix: "/featured-rooms" });
  await app.register(galleryPublicRoutes, { prefix: "/gallery" });
  await app.register(publicRoomsRoutes, { prefix: "/rooms" });
  await app.register(publicBookingExtrasRoutes, { prefix: "/booking" });
  await app.register(publicReservationCreateRoutes, { prefix: "/reservations" });
  await app.register(publicReservationPaymentSessionRoutes, { prefix: "/reservations" });
  await app.register(publicReservationPaymentStatusRoutes, { prefix: "/reservations" });
  await app.register(xenditWebhookRoutes, { prefix: "/webhooks" });
};
