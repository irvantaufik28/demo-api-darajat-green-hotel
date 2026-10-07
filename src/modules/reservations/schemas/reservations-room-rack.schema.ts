import { uuidSchema } from "../../master/master.shared.js";

export type RoomRackQuery = {
  startDate: string;
  days?: number;
  roomTypeId?: string;
};

export const roomRackQuerySchema = {
  type: "object",
  required: ["startDate"],
  additionalProperties: false,
  properties: {
    startDate: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    days: { type: "integer", minimum: 1, maximum: 31, default: 14 },
    roomTypeId: uuidSchema,
  },
} as const;
