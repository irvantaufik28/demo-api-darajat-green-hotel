import { uuidSchema } from "../../master/master.shared.js";

export type FeaturedRoomsBody = {
  items: { roomTypeId: string; isActive: boolean }[];
};

export const featuredRoomsBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomTypeId", "isActive"],
        properties: {
          roomTypeId: uuidSchema,
          isActive: { type: "boolean" },
        },
      },
    },
  },
} as const;
