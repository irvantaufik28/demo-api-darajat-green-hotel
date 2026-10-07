export type UpdateProfileBody = {
  name?: string;
  phone?: string | null;
  photoUrl?: string | null;
};

export const updateProfileSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    phone: { type: ["string", "null"], maxLength: 40 },
    photoUrl: { type: ["string", "null"], maxLength: 2048 },
  },
} as const;
