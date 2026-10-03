import { uuidSchema } from "../../master/master.shared.js";

export type GuestUpdateBody = {
  fullName: string;
  phone?: string | null;
  email?: string | null;
  nationality?: string | null;
  address?: string | null;
  internalNotes?: string | null;
  status: "active" | "blacklisted";
};

const nullableString = (maxLength: number) => ({
  anyOf: [{ type: "string", maxLength }, { type: "null" }],
});

export const guestParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const guestUpdateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["fullName", "status"],
  properties: {
    fullName: { type: "string", minLength: 1, maxLength: 160 },
    phone: nullableString(40),
    email: nullableString(255),
    nationality: nullableString(255),
    address: nullableString(5000),
    internalNotes: nullableString(10000),
    status: { type: "string", enum: ["active", "blacklisted"] },
  },
} as const;
