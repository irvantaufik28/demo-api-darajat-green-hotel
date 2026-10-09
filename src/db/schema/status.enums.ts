import { appSchema } from "./app-schema.js";

export const reservationStatusEnum = appSchema.enum("reservation_status", [
  "pending",
  "confirmed",
  "checked_in",
  "checked_out",
  "no_show",
  "cancelled",
  "expired",
]);

export const reservationPaymentStatusEnum = appSchema.enum("reservation_payment_status", [
  "unpaid",
  "partial",
  "paid",
  "failed",
  "expired",
  "refunded",
]);

export const depositStatusEnum = appSchema.enum("deposit_status", [
  "held",
  "partially_refunded",
  "refunded",
  "deducted",
]);
