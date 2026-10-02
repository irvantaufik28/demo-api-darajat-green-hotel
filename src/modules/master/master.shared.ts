export const masterCategories = {
  amenities: "amenities",
  "bed-types": "bed_types",
  "meal-types": "meal_types",
  "room-view-types": "room_view_types",
  floor: "floors",
  "experience-categories": "experience_categories",
  "ota-channels": "ota_channels",
  "payment-methods": "payment_methods",
  "cancellation-policy-types": "cancellation_policy_types",
} as const;

export type MasterCategorySlug = keyof typeof masterCategories;

export const categorySlugs = Object.keys(masterCategories) as MasterCategorySlug[];

export const uuidSchema = {
  type: "string",
  format: "uuid",
} as const;

export const sortOrderSchema = {
  type: "integer",
  minimum: 0,
  maximum: 10000,
} as const;

export function databaseErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return databaseErrorCode(error.cause);
  return undefined;
}

export function codeForName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
