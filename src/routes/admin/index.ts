import type { FastifyPluginAsync } from "fastify";
import { authRoutes } from "../../modules/auth/index.js";
import { dashboardRoutes } from "../../modules/dashboard/index.js";
import { masterRoutes } from "../../modules/master/index.js";
import { roomTypeRoutes, roomNumberRoutes } from "../../modules/rooms/index.js";
import { pricesStocksRoutes } from "../../modules/prices-stocks/index.js";
import { cancellationPolicyRoutes } from "../../modules/cancellation-policies/index.js";
import { campaignRoutes } from "../../modules/campaigns/index.js";
import { experienceRoutes } from "../../modules/experiences/index.js";
import { guestRoutes } from "../../modules/guests/index.js";
import {
  reservationListRoutes,
  reservationArrivalsTodayRoutes,
  reservationDeparturesTodayRoutes,
  reservationInHouseRoutes,
  reservationCreateRoutes,
  reservationDetailRoutes,
  reservationHistoryRoutes,
  reservationPaymentRoutes,
  reservationConfirmRoutes,
  reservationCheckInRoutes,
  reservationCheckOutRoutes,
  reservationCancelRoutes,
  reservationCancellationSettlementRoutes,
  reservationRefundRoutes,
} from "../../modules/reservations/index.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(dashboardRoutes, { prefix: "/dashboard" });
  await app.register(masterRoutes, { prefix: "/master" });
  await app.register(roomTypeRoutes, { prefix: "/room-types" });
  await app.register(roomNumberRoutes, { prefix: "/room-numbers" });
  await app.register(pricesStocksRoutes, { prefix: "/prices-stocks" });
  await app.register(cancellationPolicyRoutes, { prefix: "/cancellation-policies" });
  await app.register(campaignRoutes, { prefix: "/campaigns" });
  await app.register(experienceRoutes, { prefix: "/experiences" });
  await app.register(guestRoutes, { prefix: "/guests" });
  await app.register(reservationListRoutes, { prefix: "/reservations" });
  await app.register(reservationArrivalsTodayRoutes, { prefix: "/reservations" });
  await app.register(reservationDeparturesTodayRoutes, { prefix: "/reservations" });
  await app.register(reservationInHouseRoutes, { prefix: "/reservations" });
  await app.register(reservationCreateRoutes, { prefix: "/reservations" });
  await app.register(reservationDetailRoutes, { prefix: "/reservations" });
  await app.register(reservationHistoryRoutes, { prefix: "/reservations" });
  await app.register(reservationPaymentRoutes, { prefix: "/reservations" });
  await app.register(reservationConfirmRoutes, { prefix: "/reservations" });
  await app.register(reservationCheckInRoutes, { prefix: "/reservations" });
  await app.register(reservationCheckOutRoutes, { prefix: "/reservations" });
  await app.register(reservationCancelRoutes, { prefix: "/reservations" });
  await app.register(reservationCancellationSettlementRoutes, { prefix: "/reservations" });
  await app.register(reservationRefundRoutes, { prefix: "/reservations" });
};
