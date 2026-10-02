import { uuidSchema } from "../master/master.shared.js";

export type CancellationRuleInput = {
  timingType: "more_than" | "within";
  daysBefore: number;
  chargeType: "percentage" | "fixed" | "nights";
  chargeValue: number;
  sortOrder?: number;
};

export type CancellationPolicyBody = {
  name: string;
  policyTypeId?: string | null;
  appliesWebsite: boolean;
  appliesPhone: boolean;
  stayStart?: string | null;
  stayEnd?: string | null;
  noShowChargeType?: "percentage" | "first_night" | "full_stay" | null;
  noShowChargeValue: number;
  isActive: boolean;
  roomTypeIds: string[];
  rules: CancellationRuleInput[];
};

const dateSchema = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const nullableDateSchema = { anyOf: [dateSchema, { type: "null" }] };

export const cancellationPolicyParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

export const cancellationPolicyBodySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "appliesWebsite",
    "appliesPhone",
    "noShowChargeValue",
    "isActive",
    "roomTypeIds",
    "rules",
  ],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 160 },
    policyTypeId: { anyOf: [uuidSchema, { type: "null" }] },
    appliesWebsite: { type: "boolean" },
    appliesPhone: { type: "boolean" },
    stayStart: nullableDateSchema,
    stayEnd: nullableDateSchema,
    noShowChargeType: {
      anyOf: [
        { type: "string", enum: ["percentage", "first_night", "full_stay"] },
        { type: "null" },
      ],
    },
    noShowChargeValue: { type: "integer", minimum: 0 },
    isActive: { type: "boolean" },
    roomTypeIds: { type: "array", uniqueItems: true, items: uuidSchema },
    rules: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timingType", "daysBefore", "chargeType", "chargeValue"],
        properties: {
          timingType: { type: "string", enum: ["more_than", "within"] },
          daysBefore: { type: "integer", minimum: 0, maximum: 32767 },
          chargeType: { type: "string", enum: ["percentage", "fixed", "nights"] },
          chargeValue: { type: "integer", minimum: 0 },
          sortOrder: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;
