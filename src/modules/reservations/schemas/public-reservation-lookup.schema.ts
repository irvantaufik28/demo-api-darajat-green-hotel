export type PublicReservationLookupBody = {
  bookingCode: string;
  contactInfo: string;
};

export const publicReservationLookupBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["bookingCode", "contactInfo"],
  properties: {
    bookingCode: { type: "string", minLength: 1, maxLength: 40 },
    contactInfo: { type: "string", minLength: 3, maxLength: 255 },
  },
} as const;
