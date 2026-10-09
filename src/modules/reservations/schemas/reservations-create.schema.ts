import { uuidSchema } from "../../master/master.shared.js";
import type { EarlyCheckInInput } from "../services/reservation-early-check-in.service.js";

export type ReservationRoomInput = {
  roomTypeId: string;
  roomUnitId?: string;
  cancellationPolicyId?: string | null;
  otaRatePerNight?: number;
  adults: number;
  children: number;
  extraBeds?: number;
  adultBreakfasts?: number;
  childBreakfasts?: number;
};

export type CreateReservationBody = {
  idempotencyKey: string;
  source: "walk_in" | "phone" | "ota";
  otaChannelId?: string;
  externalReference?: string;
  guestId?: string;
  guest?: {
    fullName: string;
    nik?: string | null;
    phone?: string | null;
    email?: string | null;
  };
  checkInDate: string;
  checkOutDate: string;
  totalAdults?: number;
  totalChildren?: number;
  rooms: ReservationRoomInput[];
  confirm: boolean;
  checkIn?: boolean;
  acknowledgeOutstanding?: boolean;
  earlyCheckIn?: EarlyCheckInInput;
  promoCode?: string | null;
  cancellationPolicyId?: string | null;
  specialRequests?: string | null;
  internalNotes?: string | null;
  payment?: { methodId: string; amount: number; notes?: string | null };
  deposit?: { methodId: string; amount: number; notes?: string | null };
  experiences?: { variantId: string; quantity: number; serviceDate?: string | null }[];
};

export type ReservationQuoteBody = {
  source: "walk_in" | "phone" | "ota";
  checkInDate: string;
  checkOutDate: string;
  totalAdults?: number;
  totalChildren?: number;
  promoCode?: string | null;
  rooms: ReservationRoomInput[];
  experiences?: { variantId: string; quantity: number; serviceDate?: string | null }[];
  paymentAmount?: number;
  depositAmount?: number;
};

const stayDateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const nullableText = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const availabilityQuerySchema = {
  type: "object",
  additionalProperties: false,
  required: ["checkInDate", "checkOutDate"],
  properties: {
    checkInDate: stayDateSchema,
    checkOutDate: stayDateSchema,
    roomTypeId: uuidSchema,
    adults: { type: "integer", minimum: 1, maximum: 32767 },
    children: { type: "integer", minimum: 0, maximum: 32767 },
  },
} as const;

export const reservationQuoteBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "checkInDate", "checkOutDate", "rooms"],
  properties: {
    source: { type: "string", enum: ["walk_in", "phone", "ota"] },
    checkInDate: stayDateSchema,
    checkOutDate: stayDateSchema,
    totalAdults: { type: "integer", minimum: 1, maximum: 32767 },
    totalChildren: { type: "integer", minimum: 0, maximum: 32767 },
    promoCode: {
      anyOf: [{ type: "string", maxLength: 80, pattern: "^[A-Za-z0-9_-]*$" }, { type: "null" }],
    },
    rooms: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomTypeId", "adults", "children"],
        properties: {
          roomTypeId: uuidSchema,
          roomUnitId: uuidSchema,
          otaRatePerNight: { type: "integer", minimum: 1, maximum: 9007199254740991 },
          adults: { type: "integer", minimum: 0, maximum: 32767 },
          children: { type: "integer", minimum: 0, maximum: 32767 },
          extraBeds: { type: "integer", minimum: 0, maximum: 32767 },
          adultBreakfasts: { type: "integer", minimum: 0, maximum: 32767 },
          childBreakfasts: { type: "integer", minimum: 0, maximum: 32767 },
        },
      },
    },
    experiences: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["variantId", "quantity"],
        properties: {
          variantId: uuidSchema,
          quantity: { type: "integer", minimum: 1, maximum: 32767 },
          serviceDate: { anyOf: [stayDateSchema, { type: "null" }] },
        },
      },
    },
    paymentAmount: { type: "integer", minimum: 0, maximum: 9007199254740991 },
    depositAmount: { type: "integer", minimum: 0, maximum: 9007199254740991 },
  },
} as const;

export const createReservationBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["idempotencyKey", "source", "checkInDate", "checkOutDate", "rooms", "confirm"],
  properties: {
    idempotencyKey: { type: "string", minLength: 8, maxLength: 160 },
    source: { type: "string", enum: ["walk_in", "phone", "ota"] },
    otaChannelId: uuidSchema,
    externalReference: { type: "string", minLength: 1, maxLength: 120 },
    guestId: uuidSchema,
    guest: {
      type: "object",
      additionalProperties: false,
      required: ["fullName"],
      properties: {
        fullName: { type: "string", minLength: 1, maxLength: 160 },
        nik: { anyOf: [{ type: "string", maxLength: 32 }, { type: "null" }] },
        phone: { anyOf: [{ type: "string", maxLength: 40 }, { type: "null" }] },
        email: { anyOf: [{ type: "string", maxLength: 255 }, { type: "null" }] },
      },
    },
    checkInDate: stayDateSchema,
    checkOutDate: stayDateSchema,
    totalAdults: { type: "integer", minimum: 1, maximum: 32767 },
    totalChildren: { type: "integer", minimum: 0, maximum: 32767 },
    rooms: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["roomTypeId", "adults", "children"],
        properties: {
          roomTypeId: uuidSchema,
          roomUnitId: uuidSchema,
          otaRatePerNight: { type: "integer", minimum: 1, maximum: 9007199254740991 },
          cancellationPolicyId: { anyOf: [uuidSchema, { type: "null" }] },
          adults: { type: "integer", minimum: 0, maximum: 32767 },
          children: { type: "integer", minimum: 0, maximum: 32767 },
          extraBeds: { type: "integer", minimum: 0, maximum: 32767 },
          adultBreakfasts: { type: "integer", minimum: 0, maximum: 32767 },
          childBreakfasts: { type: "integer", minimum: 0, maximum: 32767 },
        },
      },
    },
    confirm: { type: "boolean" },
    checkIn: { type: "boolean" },
    acknowledgeOutstanding: { type: "boolean" },
    earlyCheckIn: {
      type: "object",
      additionalProperties: false,
      required: ["acknowledged", "chargeAmount", "paymentTiming"],
      properties: {
        acknowledged: { type: "boolean" },
        chargeAmount: { type: "integer", minimum: 0, maximum: 9007199254740991 },
        paymentTiming: { type: "string", enum: ["now", "later"] },
        paymentMethodId: uuidSchema,
      },
    },
    promoCode: {
      anyOf: [{ type: "string", maxLength: 80, pattern: "^[A-Za-z0-9_-]*$" }, { type: "null" }],
    },
    cancellationPolicyId: { anyOf: [uuidSchema, { type: "null" }] },
    specialRequests: nullableText,
    internalNotes: nullableText,
    payment: {
      type: "object",
      additionalProperties: false,
      required: ["methodId", "amount"],
      properties: {
        methodId: uuidSchema,
        amount: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        notes: nullableText,
      },
    },
    deposit: {
      type: "object",
      additionalProperties: false,
      required: ["methodId", "amount"],
      properties: {
        methodId: uuidSchema,
        amount: { type: "integer", minimum: 1, maximum: 9007199254740991 },
        notes: nullableText,
      },
    },
    experiences: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["variantId", "quantity"],
        properties: {
          variantId: uuidSchema,
          quantity: { type: "integer", minimum: 1, maximum: 32767 },
          serviceDate: { anyOf: [stayDateSchema, { type: "null" }] },
        },
      },
    },
  },
} as const;
