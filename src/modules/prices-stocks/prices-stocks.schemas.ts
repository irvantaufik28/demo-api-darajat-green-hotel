import { uuidSchema } from "../master/master.shared.js";

export type InventoryChange = {
  stayDate: string;
  expectedVersion: number | null;
  basePrice?: number;
  sellableStock?: number;
  minNights?: number;
  stopSell?: boolean;
};

export type BulkInventoryBody = { roomTypeId: string; changes: InventoryChange[] };

export const stayDateSchema = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
} as const;

export const inventoryListQuerySchema = {
  type: "object",
  required: ["roomTypeId", "startDate", "endDate"],
  additionalProperties: false,
  properties: {
    roomTypeId: uuidSchema,
    startDate: stayDateSchema,
    endDate: stayDateSchema,
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 30, default: 30 },
  },
} as const;

export const inventoryBulkBodySchema = {
  type: "object",
  required: ["roomTypeId", "changes"],
  additionalProperties: false,
  properties: {
    roomTypeId: uuidSchema,
    changes: {
      type: "array",
      minItems: 1,
      maxItems: 300,
      items: {
        type: "object",
        required: ["stayDate", "expectedVersion"],
        additionalProperties: false,
        properties: {
          stayDate: stayDateSchema,
          expectedVersion: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
          basePrice: { type: "integer", minimum: 0 },
          sellableStock: { type: "integer", minimum: 0, maximum: 32767 },
          minNights: { type: "integer", minimum: 1, maximum: 32767 },
          stopSell: { type: "boolean" },
        },
      },
    },
  },
} as const;
