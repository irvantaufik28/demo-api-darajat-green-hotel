import { uuidSchema } from "../../master/master.shared.js";

export const galleryCategories = [
  "rooms",
  "pools",
  "resort",
  "dining",
  "experiences",
  "landscape",
] as const;

export type GalleryCategory = (typeof galleryCategories)[number];

export type GalleryImageBody = {
  imageUrl: string;
  cloudinaryPublicId?: string | null;
  category: GalleryCategory;
  titleId?: string | null;
  titleEn?: string | null;
  captionId?: string | null;
  captionEn?: string | null;
  altTextId: string;
  altTextEn: string;
  showOnHomepage?: boolean;
  sortOrder?: number;
  isActive?: boolean;
};

const nullableString = (maxLength?: number) => ({
  anyOf: [{ type: "string", ...(maxLength ? { maxLength } : {}) }, { type: "null" }],
});

const imageProperties = {
  imageUrl: { type: "string", minLength: 1 },
  cloudinaryPublicId: nullableString(),
  category: { type: "string", enum: galleryCategories },
  titleId: nullableString(160),
  titleEn: nullableString(160),
  captionId: nullableString(),
  captionEn: nullableString(),
  altTextId: { type: "string", minLength: 1, maxLength: 255 },
  altTextEn: { type: "string", minLength: 1, maxLength: 255 },
  showOnHomepage: { type: "boolean" },
  sortOrder: { type: "integer", minimum: 0, maximum: 100000 },
  isActive: { type: "boolean" },
} as const;

export const galleryImageBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["imageUrl", "category", "altTextId", "altTextEn"],
  properties: imageProperties,
} as const;

export const galleryImageUpdateSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: imageProperties,
} as const;

export const galleryImageParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const galleryAdminQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: galleryCategories },
    isActive: { type: "boolean" },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
  },
} as const;

export const galleryPublicQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: galleryCategories },
    homepage: { type: "boolean" },
    page: { type: "integer", minimum: 1, default: 1 },
    limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
  },
} as const;

export type GalleryListQuery = {
  category?: GalleryCategory;
  isActive?: boolean;
  homepage?: boolean;
  page?: number;
  limit?: number;
};
