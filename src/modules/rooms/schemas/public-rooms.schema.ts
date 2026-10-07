import { uuidSchema } from "../../master/master.shared.js";

const stayDateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

export const publicRoomAvailabilityQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["checkInDate", "checkOutDate"],
  properties: {
    checkInDate: stayDateSchema,
    checkOutDate: stayDateSchema,
    roomTypeId: uuidSchema,
    rooms: { type: "integer", minimum: 1, maximum: 20, default: 1 },
    adults: { type: "integer", minimum: 1, maximum: 100 },
    children: { type: "integer", minimum: 0, maximum: 100 },
  },
} as const;

export const publicRoomSlugParamsSchema = {
  type: "object",
  required: ["slug"],
  properties: { slug: { type: "string", minLength: 1, maxLength: 160 } },
} as const;
