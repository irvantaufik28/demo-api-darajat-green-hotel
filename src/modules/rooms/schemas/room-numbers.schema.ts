import { uuidSchema } from "../../master/master.shared.js";

export const roomOperationalStatuses = [
  "available",
  "occupied",
  "cleaning",
  "maintenance",
  "out_of_service",
] as const;

export type RoomOperationalStatus = (typeof roomOperationalStatuses)[number];

export type RoomNumberBody = {
  roomNumber: string;
  roomTypeId: string;
  floorId?: string | null;
  bedConfiguration?: string | null;
  operationalStatus: RoomOperationalStatus;
  isActive: boolean;
};

export const roomNumberBodySchema = {
  type: "object",
  required: ["roomNumber", "roomTypeId", "operationalStatus", "isActive"],
  additionalProperties: false,
  properties: {
    roomNumber: { type: "string", minLength: 1, maxLength: 30 },
    roomTypeId: uuidSchema,
    floorId: { anyOf: [uuidSchema, { type: "null" }] },
    bedConfiguration: { type: ["string", "null"], maxLength: 160 },
    operationalStatus: { type: "string", enum: roomOperationalStatuses },
    isActive: { type: "boolean" },
  },
} as const;

export const roomNumberParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;
