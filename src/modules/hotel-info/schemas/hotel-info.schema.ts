import { uuidSchema } from "../../master/master.shared.js";

export type HotelInfoBody = {
  name: string;
  shortDescription?: string | null;
  description?: string | null;
  address: string;
  district?: string | null;
  city: string;
  province: string;
  postalCode?: string | null;
  googleMapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  whatsappNumber?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  logoPublicId?: string | null;
  faviconUrl?: string | null;
  faviconPublicId?: string | null;
};

export type FacilityBody = {
  name: string;
  kind: "facility" | "service";
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export const hotelInfoBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "address", "city", "province"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    shortDescription: nullableString(300),
    description: nullableString(),
    address: { type: "string", minLength: 1 },
    district: nullableString(120),
    city: { type: "string", minLength: 1, maxLength: 120 },
    province: { type: "string", minLength: 1, maxLength: 120 },
    postalCode: nullableString(12),
    googleMapsUrl: nullableString(),
    latitude: nullableNumber(-90, 90),
    longitude: nullableNumber(-180, 180),
    phone: nullableString(30),
    whatsappNumber: nullableString(30),
    email: { anyOf: [{ type: "string", format: "email", maxLength: 254 }, { type: "null" }] },
    logoUrl: nullableString(),
    logoPublicId: nullableString(),
    faviconUrl: nullableString(),
    faviconPublicId: nullableString(),
  },
} as const;

export const facilityBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "kind"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    kind: { type: "string", enum: ["facility", "service"] },
    description: nullableString(),
    sortOrder: { type: "integer", minimum: 0, maximum: 10000 },
    isActive: { type: "boolean" },
  },
} as const;

export const facilityUpdateSchema = {
  ...facilityBodySchema,
  minProperties: 1,
  required: [],
} as const;

export const facilityParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

function nullableString(maxLength?: number) {
  return { anyOf: [{ type: "string", ...(maxLength ? { maxLength } : {}) }, { type: "null" }] };
}

function nullableNumber(minimum: number, maximum: number) {
  return { anyOf: [{ type: "number", minimum, maximum }, { type: "null" }] };
}
