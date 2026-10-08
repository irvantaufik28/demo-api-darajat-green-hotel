export type PublicBookingExtrasQuery = {
  checkInDate: string;
  checkOutDate: string;
  roomTypeIds: string;
};

const stayDateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

export const publicBookingExtrasQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["checkInDate", "checkOutDate", "roomTypeIds"],
  properties: {
    checkInDate: stayDateSchema,
    checkOutDate: stayDateSchema,
    roomTypeIds: { type: "string", minLength: 36, maxLength: 739 },
  },
} as const;
