import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../../plugins/database.js";
import { cancellationPolicies } from "../../db/schema/cancellation_policies.schema.js";
import { cancellationPolicyRoomTypes } from "../../db/schema/cancellation_policy_room_types.schema.js";
import { cancellationRules } from "../../db/schema/cancellation_rules.schema.js";
import { masterItems } from "../../db/schema/master_items.schema.js";
import { roomTypes } from "../../db/schema/room_types.schema.js";
import type { CancellationPolicyBody } from "./cancellation-policies.schemas.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class CancellationPolicyInputError extends Error {}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export async function validateCancellationPolicy(db: Database, body: CancellationPolicyBody) {
  if (!body.appliesWebsite && !body.appliesPhone) {
    throw new CancellationPolicyInputError("Select Website, Phone, or both");
  }
  if (
    (body.stayStart && !validDate(body.stayStart)) ||
    (body.stayEnd && !validDate(body.stayEnd))
  ) {
    throw new CancellationPolicyInputError("Stay dates must be valid calendar dates");
  }
  if (body.stayStart && body.stayEnd && body.stayEnd < body.stayStart) {
    throw new CancellationPolicyInputError("Stay end must be on or after stay start");
  }
  if (body.noShowChargeType === "percentage" && body.noShowChargeValue > 100) {
    throw new CancellationPolicyInputError("No-show percentage cannot exceed 100");
  }
  if (body.noShowChargeType === "first_night" && body.noShowChargeValue !== 1) {
    throw new CancellationPolicyInputError("First-night no-show charge must be one night");
  }
  if (body.noShowChargeType === "full_stay" && body.noShowChargeValue !== 100) {
    throw new CancellationPolicyInputError("Full-stay no-show charge must be 100 percent");
  }
  if (!body.noShowChargeType && body.noShowChargeValue !== 0) {
    throw new CancellationPolicyInputError("No-show charge must be zero when no type is selected");
  }
  if (body.rules.some((rule) => rule.chargeType === "percentage" && rule.chargeValue > 100)) {
    throw new CancellationPolicyInputError("Cancellation percentage cannot exceed 100");
  }
  if (
    new Set(body.rules.map((rule) => `${rule.timingType}:${rule.daysBefore}`)).size !==
    body.rules.length
  ) {
    throw new CancellationPolicyInputError("Cancellation timing rules must be unique");
  }
  if (new Set(body.roomTypeIds).size !== body.roomTypeIds.length) {
    throw new CancellationPolicyInputError("Room types must be unique");
  }
  const [policyType] = await db
    .select({ name: masterItems.name })
    .from(masterItems)
    .where(
      and(
        eq(masterItems.id, body.policyTypeId),
        eq(masterItems.category, "cancellation_policy_types"),
        eq(masterItems.isActive, true),
      ),
    )
    .limit(1);
  if (!policyType) throw new CancellationPolicyInputError("Policy type not found or inactive");
  if (body.roomTypeIds.length) {
    const found = await db
      .select({ id: roomTypes.id })
      .from(roomTypes)
      .where(inArray(roomTypes.id, body.roomTypeIds));
    if (found.length !== body.roomTypeIds.length) {
      throw new CancellationPolicyInputError("One or more room types were not found");
    }
  }
  return policyType.name;
}

export function cancellationPolicyValues(body: CancellationPolicyBody, policyTypeName: string) {
  return {
    name: policyTypeName,
    policyTypeId: body.policyTypeId,
    appliesWebsite: body.appliesWebsite,
    appliesPhone: body.appliesPhone,
    stayStart: body.stayStart ?? null,
    stayEnd: body.stayEnd ?? null,
    noShowChargeType: body.noShowChargeType ?? null,
    noShowChargeValue: body.noShowChargeValue,
    isActive: body.isActive,
  };
}

export async function replaceCancellationPolicyRelations(
  tx: Transaction,
  policyId: string,
  body: CancellationPolicyBody,
) {
  await tx.delete(cancellationRules).where(eq(cancellationRules.policyId, policyId));
  await tx
    .delete(cancellationPolicyRoomTypes)
    .where(eq(cancellationPolicyRoomTypes.policyId, policyId));
  await tx.insert(cancellationRules).values(
    body.rules.map((rule, index) => ({
      policyId,
      timingType: rule.timingType,
      daysBefore: rule.daysBefore,
      chargeType: rule.chargeType,
      chargeValue: rule.chargeValue,
      sortOrder: rule.sortOrder ?? index,
    })),
  );
  if (body.roomTypeIds.length) {
    await tx
      .insert(cancellationPolicyRoomTypes)
      .values(body.roomTypeIds.map((roomTypeId) => ({ policyId, roomTypeId })));
  }
}

export async function getCancellationPolicyDetail(db: Database, id: string) {
  const [policy] = await db
    .select()
    .from(cancellationPolicies)
    .where(eq(cancellationPolicies.id, id))
    .limit(1);
  if (!policy) return null;
  const [rules, roomTypesList] = await Promise.all([
    db
      .select()
      .from(cancellationRules)
      .where(eq(cancellationRules.policyId, id))
      .orderBy(asc(cancellationRules.sortOrder)),
    db
      .select({ id: roomTypes.id, code: roomTypes.code, name: roomTypes.name })
      .from(cancellationPolicyRoomTypes)
      .innerJoin(roomTypes, eq(cancellationPolicyRoomTypes.roomTypeId, roomTypes.id))
      .where(eq(cancellationPolicyRoomTypes.policyId, id))
      .orderBy(asc(roomTypes.name)),
  ]);
  return { ...policy, rules, roomTypes: roomTypesList };
}
