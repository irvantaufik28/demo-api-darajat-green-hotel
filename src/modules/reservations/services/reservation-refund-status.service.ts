/** A cancellation refund settles the cancellation charge, not the original booking total. */
export function paymentStatusAfterCancellationRefund(
  grossPaid: number,
  netPaid: number,
  bookingTotal: number,
) {
  if (grossPaid > 0 && netPaid === 0) return "refunded" as const;
  if (grossPaid === 0) return "unpaid" as const;
  return grossPaid >= bookingTotal ? ("paid" as const) : ("partial" as const);
}
