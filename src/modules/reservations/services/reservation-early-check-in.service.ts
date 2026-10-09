import { and, eq } from "drizzle-orm";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservationCharges } from "../../../db/schema/reservation_charges.schema.js";
import { reservationSettings } from "../../../db/schema/reservation_settings.schema.js";
import type { Database } from "../../../plugins/database.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;

export type EarlyCheckInInput = {
  acknowledged: boolean;
  chargeAmount: number;
  paymentTiming: "now" | "later";
  paymentMethodId?: string;
};

export class EarlyCheckInError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const settingsId = "00000000-0000-4000-8000-000000000001";

export async function getEarlyCheckInContext(
  db: QueryDatabase,
  checkInDate: string,
  now = new Date(),
) {
  const [row] = await db
    .select({
      checkInTime: reservationSettings.checkInTime,
      allowOutstandingCheckIn: reservationSettings.allowOutstandingCheckIn,
    })
    .from(reservationSettings)
    .where(eq(reservationSettings.id, settingsId))
    .limit(1);
  const standardCheckInTime = row?.checkInTime.slice(0, 5) ?? "14:00";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  const serverDate = `${value("year")}-${value("month")}-${value("day")}`;
  const serverTime = `${value("hour")}:${value("minute")}`;
  return {
    checkInDate,
    serverDate,
    serverTime,
    standardCheckInTime,
    allowOutstandingCheckIn: row?.allowOutstandingCheckIn ?? true,
    required: checkInDate === serverDate && serverTime < standardCheckInTime,
  };
}

export async function addEarlyCheckInCharge(
  tx: Transaction,
  input: {
    reservationId: string;
    checkInDate: string;
    actorUserId: string;
    earlyCheckIn: EarlyCheckInInput;
  },
) {
  const { earlyCheckIn, reservationId, actorUserId } = input;
  const chargeAmount = earlyCheckIn.chargeAmount;
  if (!Number.isSafeInteger(chargeAmount) || chargeAmount < 0) {
    throw new EarlyCheckInError(
      "INVALID_EARLY_CHECK_IN_CHARGE",
      "Enter a valid early check-in charge",
    );
  }
  if (chargeAmount === 0) return { chargeId: null, paymentId: null };

  if (earlyCheckIn.paymentTiming === "now") {
    if (!earlyCheckIn.paymentMethodId)
      throw new EarlyCheckInError(
        "EARLY_CHECK_IN_PAYMENT_METHOD_REQUIRED",
        "Select a payment method for the early check-in charge",
      );
    const [method] = await tx
      .select({ id: masterItems.id })
      .from(masterItems)
      .where(
        and(
          eq(masterItems.id, earlyCheckIn.paymentMethodId),
          eq(masterItems.category, "payment_methods"),
          eq(masterItems.isActive, true),
        ),
      )
      .limit(1);
    if (!method)
      throw new EarlyCheckInError(
        "INVALID_EARLY_CHECK_IN_PAYMENT_METHOD",
        "Select an active payment method",
      );
  }

  const [charge] = await tx
    .insert(reservationCharges)
    .values({
      reservationId,
      kind: "adjustment",
      description: "Early check-in charge",
      quantity: "1",
      unitAmount: chargeAmount,
      amount: chargeAmount,
      serviceDate: input.checkInDate,
      createdByUserId: actorUserId,
    })
    .returning({ id: reservationCharges.id });

  const [payment] =
    earlyCheckIn.paymentTiming === "now"
      ? await tx
          .insert(payments)
          .values({
            reservationId,
            methodId: earlyCheckIn.paymentMethodId!,
            amount: chargeAmount,
            status: "succeeded",
            paidAt: new Date(),
            recordedByUserId: actorUserId,
            notes: "Early check-in charge",
          })
          .returning({ id: payments.id })
      : [];
  return { chargeId: charge.id, paymentId: payment?.id ?? null };
}
