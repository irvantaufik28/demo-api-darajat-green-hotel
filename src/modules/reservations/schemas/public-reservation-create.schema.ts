import {
  publicRoomQuoteBodySchema,
  type PublicRoomQuoteBody,
} from "../../rooms/schemas/public-room-quote.schema.js";

export type PublicReservationCreateBody = PublicRoomQuoteBody & {
  idempotencyKey: string;
  guest: {
    fullName: string;
    phone: string;
    email: string;
    nationality?: string | null;
  };
  specialRequests?: string | null;
};

export const publicReservationCreateBodySchema = {
  ...publicRoomQuoteBodySchema,
  required: [...publicRoomQuoteBodySchema.required, "idempotencyKey", "guest"],
  properties: {
    ...publicRoomQuoteBodySchema.properties,
    idempotencyKey: { type: "string", minLength: 8, maxLength: 160 },
    guest: {
      type: "object",
      additionalProperties: false,
      required: ["fullName", "phone", "email"],
      properties: {
        fullName: { type: "string", minLength: 1, maxLength: 160 },
        phone: { type: "string", minLength: 6, maxLength: 40 },
        email: { type: "string", format: "email", maxLength: 255 },
        nationality: { anyOf: [{ type: "string", maxLength: 100 }, { type: "null" }] },
      },
    },
    specialRequests: { anyOf: [{ type: "string", maxLength: 5000 }, { type: "null" }] },
  },
} as const;
