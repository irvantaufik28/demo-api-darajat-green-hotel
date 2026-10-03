import { uuidSchema } from "../../master/master.shared.js";

export type CampaignChannel = "website" | "front_desk";
export type BlackoutDateInput = { dateFrom: string; dateTo: string; label?: string | null };

export type CampaignBody = {
  name: string;
  promoCode?: string | null;
  requiresCode: boolean;
  bookingStart?: string | null;
  bookingEnd?: string | null;
  stayStart?: string | null;
  stayEnd?: string | null;
  discountType: "percent" | "fixed";
  discountValue: number;
  minNights: number;
  minRooms: number;
  priority: number;
  cancellationPolicyId?: string | null;
  isActive: boolean;
  channel: CampaignChannel;
  roomTypeIds: string[];
  weekdays: number[];
  blackoutDates: BlackoutDateInput[];
};

const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const nullableDateSchema = { anyOf: [dateSchema, { type: "null" }] };

export const campaignParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const campaignBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "requiresCode",
    "discountType",
    "discountValue",
    "minNights",
    "minRooms",
    "priority",
    "isActive",
    "channel",
    "roomTypeIds",
    "weekdays",
    "blackoutDates",
  ],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    promoCode: {
      anyOf: [{ type: "string", maxLength: 80, pattern: "^[A-Za-z0-9_-]*$" }, { type: "null" }],
    },
    requiresCode: { type: "boolean" },
    bookingStart: nullableDateSchema,
    bookingEnd: nullableDateSchema,
    stayStart: nullableDateSchema,
    stayEnd: nullableDateSchema,
    discountType: { type: "string", enum: ["percent", "fixed"] },
    discountValue: { type: "integer", minimum: 0 },
    minNights: { type: "integer", minimum: 1, maximum: 32767 },
    minRooms: { type: "integer", minimum: 1, maximum: 32767 },
    priority: { type: "integer", minimum: 1, maximum: 10000 },
    cancellationPolicyId: { anyOf: [uuidSchema, { type: "null" }] },
    isActive: { type: "boolean" },
    channel: { type: "string", enum: ["website", "front_desk"] },
    roomTypeIds: { type: "array", uniqueItems: true, items: uuidSchema },
    weekdays: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "integer", minimum: 1, maximum: 7 },
    },
    blackoutDates: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        required: ["dateFrom", "dateTo"],
        additionalProperties: false,
        properties: {
          dateFrom: dateSchema,
          dateTo: dateSchema,
          label: { type: ["string", "null"], maxLength: 160 },
        },
      },
    },
  },
} as const;
