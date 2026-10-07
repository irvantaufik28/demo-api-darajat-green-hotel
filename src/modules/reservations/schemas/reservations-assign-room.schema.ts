import { uuidSchema } from "../../master/master.shared.js";

export type AssignRoomParams = {
  id: string;
  roomId: string;
};

export type AssignRoomBody = {
  roomUnitId: string | null;
  expectedVersion: number;
  reason?: string;
};

export const assignRoomParamsSchema = {
  type: "object",
  required: ["id", "roomId"],
  additionalProperties: false,
  properties: { id: uuidSchema, roomId: uuidSchema },
} as const;

export const assignRoomBodySchema = {
  type: "object",
  required: ["roomUnitId", "expectedVersion"],
  additionalProperties: false,
  properties: {
    roomUnitId: { anyOf: [uuidSchema, { type: "null" }] },
    expectedVersion: { type: "integer", minimum: 1 },
    reason: { type: "string", minLength: 1, maxLength: 500 },
  },
} as const;
