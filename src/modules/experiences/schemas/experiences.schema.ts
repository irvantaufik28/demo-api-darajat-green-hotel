import { uuidSchema } from "../../master/master.shared.js";

export type ExperienceBody = {
  categoryId: string;
  code: string;
  slug: string;
  name: string;
  description?: string | null;
  maxQuantity: number;
  imageUrl?: string | null;
  coverImageUrl?: string | null;
  isActive: boolean;
  variants: {
    subName: string;
    description?: string | null;
    imageUrl?: string | null;
    price: number;
  }[];
};

export const experienceBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["categoryId", "code", "slug", "name", "maxQuantity", "isActive", "variants"],
  properties: {
    categoryId: uuidSchema,
    code: { type: "string", minLength: 1, maxLength: 120 },
    slug: { type: "string", minLength: 1, maxLength: 120 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    description: { anyOf: [{ type: "string" }, { type: "null" }] },
    maxQuantity: { type: "integer", minimum: 1, maximum: 32767 },
    imageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
    coverImageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
    isActive: { type: "boolean" },
    variants: {
      type: "array",
      minItems: 1,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subName", "price"],
        properties: {
          subName: { type: "string", minLength: 1, maxLength: 160 },
          description: { anyOf: [{ type: "string" }, { type: "null" }] },
          imageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
          price: { type: "integer", minimum: 0, maximum: 9007199254740991 },
        },
      },
    },
  },
} as const;

export const experienceParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;
