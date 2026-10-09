import { and, eq } from "drizzle-orm";
import { masterItems } from "../../../db/schema/master_items.schema.js";
import { payments } from "../../../db/schema/payments.schema.js";
import { reservationCharges } from "../../../db/schema/reservation_charges.schema.js";
import { reservationSettings } from "../../../db/schema/reservation_settings.schema.js";
import type { Database } from "../../../plugins/database.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;

export type LateCheckOutInput = {
  acknowledged: boolean;
  chargeAmount: number;
  paymentTiming: "now" | "later";
  paymentMethodId?: string;
};

export class CheckOutTimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function getCheckOutClock(db: QueryDatabase, now = new Date()) {
  const [settings] = await db
    .select({
      checkOutTime: reservationSettings.checkOutTime,
      allowOutstandingCheckOut: reservationSettings.allowOutstandingCheckOut,
    })
    .from(reservationSettings)
    .where(eq(reservationSettings.id, "00000000-0000-4000-8000-000000000001"))
    .limit(1);
  const standardCheckOutTime = settings?.checkOutTime.slice(0, 5) ?? "12:00";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  const serverDate = `${value("year")}-${value("month")}-${value("day")}`;
  const serverTime = `${value("hour")}:${value("minute")}`;
  const serverSeconds =
    Number(value("hour")) * 3600 + Number(value("minute")) * 60 + Number(value("second"));
  const standardSeconds =
    Number(standardCheckOutTime.slice(0, 2)) * 3600 + Number(standardCheckOutTime.slice(3, 5)) * 60;
  return {
    serverDate,
    serverTime,
    standardCheckOutTime,
    allowOutstandingCheckOut: settings?.allowOutstandingCheckOut ?? true,
    afterCheckOutTime: serverSeconds > standardSeconds,
    minutesPastCheckOutTime: Math.floor(Math.max(0, serverSeconds - standardSeconds) / 60),
  };
}

export type CheckOutClock = Awaited<ReturnType<typeof getCheckOutClock>>;

export async function getCheckOutTimeContext(
  db: QueryDatabase,
  checkOutDate: string,
  now = new Date(),
) {
  const clock = await getCheckOutClock(db, now);
  const { serverDate, serverTime, standardCheckOutTime, allowOutstandingCheckOut } = clock;
  const kind =
    serverDate < checkOutDate
      ? "early_departure"
      : serverDate > checkOutDate || clock.afterCheckOutTime
        ? "late_checkout"
        : "normal";
  return {
    checkOutDate,
    serverDate,
    serverTime,
    standardCheckOutTime,
    allowOutstandingCheckOut,
    kind,
  } as const;
}

export async function addLateCheckOutCharge(
  tx: Transaction,
  input: {
    reservationId: string;
    checkOutDate: string;
    actorUserId: string;
    lateCheckOut: LateCheckOutInput;
  },
) {
  const { reservationId, actorUserId, lateCheckOut } = input;
  const amount = lateCheckOut.chargeAmount;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new CheckOutTimeError(
      "INVALID_LATE_CHECKOUT_CHARGE",
      "Enter a valid late checkout charge",
    );
  }
  if (amount === 0) return { chargeId: null, paymentId: null };

  if (lateCheckOut.paymentTiming === "now") {
    if (!lateCheckOut.paymentMethodId) {
      throw new CheckOutTimeError(
        "LATE_CHECKOUT_PAYMENT_METHOD_REQUIRED",
        "Select a payment method for the late checkout charge",
      );
    }
    const [method] = await tx
      .select({ id: masterItems.id })
      .from(masterItems)
      .where(
        and(
          eq(masterItems.id, lateCheckOut.paymentMethodId),
          eq(masterItems.category, "payment_methods"),
          eq(masterItems.isActive, true),
        ),
      )
      .limit(1);
    if (!method) {
      throw new CheckOutTimeError(
        "INVALID_LATE_CHECKOUT_PAYMENT_METHOD",
        "Select an active payment method",
      );
    }
  }

  const [charge] = await tx
    .insert(reservationCharges)
    .values({
      reservationId,
      kind: "adjustment",
      description: "Late checkout charge",
      quantity: "1",
      unitAmount: amount,
      amount,
      serviceDate: input.checkOutDate,
      createdByUserId: actorUserId,
    })
    .returning({ id: reservationCharges.id });

  const [payment] =
    lateCheckOut.paymentTiming === "now"
      ? await tx
          .insert(payments)
          .values({
            reservationId,
            methodId: lateCheckOut.paymentMethodId!,
            amount,
            status: "succeeded",
            paidAt: new Date(),
            recordedByUserId: actorUserId,
            notes: "Late checkout charge",
          })
          .returning({ id: payments.id })
      : [];
  return { chargeId: charge.id, paymentId: payment?.id ?? null };
}
