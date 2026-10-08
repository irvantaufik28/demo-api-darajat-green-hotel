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

export type AssignRoomsByTypeBody = {
  expectedVersion: number;
  assignments: { reservationRoomId: string; roomUnitId: string }[];
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

export const assignRoomsByTypeBodySchema = {
  type: "object",
  required: ["expectedVersion", "assignments"],
  additionalProperties: false,
  properties: {
    expectedVersion: { type: "integer", minimum: 1 },
    assignments: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        required: ["reservationRoomId", "roomUnitId"],
        additionalProperties: false,
        properties: {
          reservationRoomId: uuidSchema,
          roomUnitId: uuidSchema,
        },
      },
    },
  },
} as const;
