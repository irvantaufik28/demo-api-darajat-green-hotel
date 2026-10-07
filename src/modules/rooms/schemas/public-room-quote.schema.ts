import { uuidSchema } from "../../master/master.shared.js";

export type PublicRoomQuoteBody = {
  checkInDate: string;
  checkOutDate: string;
  totalAdults?: number;
  totalChildren?: number;
  promoCode?: string | null;
  rooms: {
    roomTypeId: string;
    adults: number;
    children: number;
    extraBeds?: number;
    adultBreakfasts?: number;
    childBreakfasts?: number;
    cancellationPolicyId?: string | null;
  }[];
  experiences?: { variantId: string; quantity: number; serviceDate?: string | null }[];
};

const stayDateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

export const publicRoomQuoteBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["checkInDate", "checkOutDate", "rooms"],
  properties: {
    checkInDate: stayDateSchema,
    checkOutDate: stayDateSchema,
    totalAdults: { type: "integer", minimum: 1, maximum: 100 },
    totalChildren: { type: "integer", minimum: 0, maximum: 100 },
    promoCode: {
      anyOf: [{ type: "string", maxLength: 80, pattern: "^[A-Za-z0-9_-]*$" }, { type: "null" }],
    },
    rooms: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomTypeId", "adults", "children"],
        properties: {
          roomTypeId: uuidSchema,
          adults: { type: "integer", minimum: 0, maximum: 100 },
          children: { type: "integer", minimum: 0, maximum: 100 },
          extraBeds: { type: "integer", minimum: 0, maximum: 20 },
          adultBreakfasts: { type: "integer", minimum: 0, maximum: 100 },
          childBreakfasts: { type: "integer", minimum: 0, maximum: 100 },
          cancellationPolicyId: { anyOf: [uuidSchema, { type: "null" }] },
        },
      },
    },
    experiences: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["variantId", "quantity"],
        properties: {
          variantId: uuidSchema,
          quantity: { type: "integer", minimum: 1, maximum: 32767 },
          serviceDate: { anyOf: [stayDateSchema, { type: "null" }] },
        },
      },
    },
  },
} as const;
