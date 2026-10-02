import { uuidSchema } from "../master/master.shared.js";

export type RoomTypeImageInput = {
  url: string;
  altText?: string | null;
  isCover?: boolean;
  sortOrder?: number;
};

export type RoomTypeCapacityInput = { capacityPatternId: string; extraBeds: number };

export type RoomTypeBody = {
  code: string;
  slug: string;
  name: string;
  description?: string | null;
  sizeSqm?: string | null;
  bedTypeId?: string | null;
  mealTypeId?: string | null;
  viewTypeId?: string | null;
  bedCount: number;
  extraBedEnabled: boolean;
  maxExtraBeds: number;
  extraBedPricePerNight: number;
  adultBreakfastPrice: number;
  childBreakfastPrice: number;
  basePricePerNight: number;
  amenityIds: string[];
  capacityPatterns: RoomTypeCapacityInput[];
  images: RoomTypeImageInput[];
};

const nullableUuid = { anyOf: [uuidSchema, { type: "null" }] };
const money = { type: "integer", minimum: 0 };

export const roomTypeBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "code",
    "slug",
    "name",
    "bedCount",
    "extraBedEnabled",
    "maxExtraBeds",
    "extraBedPricePerNight",
    "adultBreakfastPrice",
    "childBreakfastPrice",
    "basePricePerNight",
    "amenityIds",
    "capacityPatterns",
    "images",
  ],
  properties: {
    code: { type: "string", pattern: "^[a-zA-Z0-9_-]+$", minLength: 1, maxLength: 40 },
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 120 },
    name: { type: "string", minLength: 1, maxLength: 160 },
    description: { type: ["string", "null"] },
    sizeSqm: {
      anyOf: [{ type: "string", pattern: "^[0-9]{1,4}(\\.[0-9]{1,2})?$" }, { type: "null" }],
    },
    bedTypeId: nullableUuid,
    mealTypeId: nullableUuid,
    viewTypeId: nullableUuid,
    bedCount: { type: "integer", minimum: 1, maximum: 100 },
    extraBedEnabled: { type: "boolean" },
    maxExtraBeds: { type: "integer", minimum: 0, maximum: 100 },
    extraBedPricePerNight: money,
    adultBreakfastPrice: money,
    childBreakfastPrice: money,
    basePricePerNight: money,
    amenityIds: { type: "array", uniqueItems: true, items: uuidSchema },
    capacityPatterns: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["capacityPatternId", "extraBeds"],
        properties: {
          capacityPatternId: uuidSchema,
          extraBeds: { type: "integer", minimum: 0, maximum: 100 },
        },
      },
    },
    images: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["url"],
        properties: {
          url: { type: "string", minLength: 1, maxLength: 2048 },
          altText: { type: ["string", "null"], maxLength: 255 },
          isCover: { type: "boolean" },
          sortOrder: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

export const roomTypeParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;
