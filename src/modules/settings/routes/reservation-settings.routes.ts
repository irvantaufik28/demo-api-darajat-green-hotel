import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { reservationSettings } from "../../../db/schema/reservation_settings.schema.js";

type SettingsBody = {
  checkInTime: string;
  checkOutTime: string;
  autoConfirmWebsiteAfterPayment: boolean;
  allowOutstandingCheckIn: boolean;
  allowOutstandingCheckOut: boolean;
  websitePaymentExpiryMinutes: number;
};

const settingsId = "00000000-0000-4000-8000-000000000001";
const defaults: SettingsBody = {
  checkInTime: "14:00",
  checkOutTime: "12:00",
  autoConfirmWebsiteAfterPayment: true,
  allowOutstandingCheckIn: true,
  allowOutstandingCheckOut: true,
  websitePaymentExpiryMinutes: 30,
};

const bodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "checkInTime",
    "checkOutTime",
    "autoConfirmWebsiteAfterPayment",
    "allowOutstandingCheckIn",
    "allowOutstandingCheckOut",
    "websitePaymentExpiryMinutes",
  ],
  properties: {
    checkInTime: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" },
    checkOutTime: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" },
    autoConfirmWebsiteAfterPayment: { type: "boolean" },
    allowOutstandingCheckIn: { type: "boolean" },
    allowOutstandingCheckOut: { type: "boolean" },
    websitePaymentExpiryMinutes: { type: "integer", minimum: 1, maximum: 1440 },
  },
} as const;

function response(row: typeof reservationSettings.$inferSelect | undefined) {
  return {
    settings: row
      ? {
          checkInTime: row.checkInTime.slice(0, 5),
          checkOutTime: row.checkOutTime.slice(0, 5),
          autoConfirmWebsiteAfterPayment: row.autoConfirmWebsiteAfterPayment,
          allowOutstandingCheckIn: row.allowOutstandingCheckIn,
          allowOutstandingCheckOut: row.allowOutstandingCheckOut,
          websitePaymentExpiryMinutes: row.websitePaymentExpiryMinutes,
        }
      : defaults,
    noShowMode: "manual" as const,
    updatedAt: row?.updatedAt ?? null,
    updatedByUserId: row?.updatedByUserId ?? null,
  };
}

export const reservationSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/reservations",
    { preHandler: app.requirePermission("master.view") },
    async () => {
      const [row] = await app.db
        .select()
        .from(reservationSettings)
        .where(eq(reservationSettings.id, settingsId))
        .limit(1);
      return response(row);
    },
  );

  app.put<{ Body: SettingsBody }>(
    "/reservations",
    {
      preHandler: app.requirePermission("master.edit"),
      schema: { body: bodySchema },
    },
    async (request) => {
      const [row] = await app.db
        .insert(reservationSettings)
        .values({
          id: settingsId,
          ...request.body,
          noShowMode: "manual",
          updatedByUserId: request.authUser!.id,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: reservationSettings.id,
          set: {
            ...request.body,
            noShowMode: "manual",
            updatedByUserId: request.authUser!.id,
            updatedAt: new Date(),
          },
        })
        .returning();
      return response(row);
    },
  );
};
