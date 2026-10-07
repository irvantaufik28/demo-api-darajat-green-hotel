import { uuidSchema } from "../../master/master.shared.js";

const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

export type MaintenanceListQuery = {
  startDate: string;
  endDate: string;
  roomTypeId?: string;
  roomUnitId?: string;
  includeCancelled?: boolean;
};

export type CreateMaintenanceBody = {
  roomUnitId: string;
  startDate: string;
  endDate: string;
  reason: string;
};

export const maintenanceListQuerySchema = {
  type: "object",
  required: ["startDate", "endDate"],
  additionalProperties: false,
  properties: {
    startDate: dateSchema,
    endDate: dateSchema,
    roomTypeId: uuidSchema,
    roomUnitId: uuidSchema,
    includeCancelled: { type: "boolean", default: false },
  },
} as const;

export const createMaintenanceBodySchema = {
  type: "object",
  required: ["roomUnitId", "startDate", "endDate", "reason"],
  additionalProperties: false,
  properties: {
    roomUnitId: uuidSchema,
    startDate: dateSchema,
    endDate: dateSchema,
    reason: { type: "string", minLength: 1, maxLength: 1000 },
  },
} as const;

export const maintenanceIdParamsSchema = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: uuidSchema },
} as const;
