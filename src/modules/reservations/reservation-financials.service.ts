import { eq, inArray } from "drizzle-orm";
import { paymentRefunds } from "../../db/schema/payment_refunds.schema.js";
import { payments } from "../../db/schema/payments.schema.js";
import { reservationCharges } from "../../db/schema/reservation_charges.schema.js";
import { reservationDeposits } from "../../db/schema/reservation_deposits.schema.js";
import type { Database } from "../../plugins/database.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;

export async function readReservationFinancials(db: QueryDatabase, reservationId: string) {
  const [charges, paymentRows, deposits] = await Promise.all([
    db.select().from(reservationCharges).where(eq(reservationCharges.reservationId, reservationId)),
    db.select().from(payments).where(eq(payments.reservationId, reservationId)),
    db
      .select()
      .from(reservationDeposits)
      .where(eq(reservationDeposits.reservationId, reservationId)),
  ]);
  const paymentIds = paymentRows.map((payment) => payment.id);
  const refunds = paymentIds.length
    ? await db.select().from(paymentRefunds).where(inArray(paymentRefunds.paymentId, paymentIds))
    : [];

  const bookingTotal = charges.reduce((sum, charge) => sum + charge.amount, 0);
  const roomTotal = charges.reduce(
    (sum, charge) => sum + (charge.kind === "room" ? charge.amount : 0),
    0,
  );
  const grossPaidAmount = paymentRows.reduce(
    (sum, payment) =>
      sum +
      (["succeeded", "partially_refunded", "refunded"].includes(payment.status)
        ? payment.amount
        : 0),
    0,
  );
  const refundedAmount = refunds.reduce(
    (sum, refund) => sum + (refund.status === "succeeded" ? refund.amount : 0),
    0,
  );
  const pendingRefundAmount = refunds.reduce(
    (sum, refund) => sum + (refund.status === "pending" ? refund.amount : 0),
    0,
  );
  const netPaidAmount = Math.max(0, grossPaidAmount - refundedAmount);
  const depositBalance = deposits.reduce(
    (sum, deposit) => sum + deposit.amountHeld - deposit.amountRefunded - deposit.amountDeducted,
    0,
  );

  return {
    charges,
    payments: paymentRows,
    refunds,
    deposits,
    bookingTotal,
    roomTotal,
    otherCharges: bookingTotal - roomTotal,
    grossPaidAmount,
    refundedAmount,
    pendingRefundAmount,
    netPaidAmount,
    remainingBalance: Math.max(0, bookingTotal - netPaidAmount),
    depositBalance,
  };
}
