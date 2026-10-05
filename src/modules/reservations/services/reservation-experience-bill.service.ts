import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../../../plugins/database.js";
import { experienceVariants } from "../../../db/schema/experience_variants.schema.js";
import { experiences } from "../../../db/schema/experiences.schema.js";
import { reservationCharges } from "../../../db/schema/reservation_charges.schema.js";
import { reservationExperiences } from "../../../db/schema/reservation_experiences.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { readReservationFinancials } from "./reservation-financials.service.js";
import { recordReservationEvent } from "./reservation-events.service.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryDatabase = Database | Transaction;
export type BillItem = { variantId: string; quantity: number; serviceDate?: string | null };

export class ExperienceBillError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 409) {
    super(message);
  }
}

export async function quoteExperienceBill(db: QueryDatabase, reservationId: string, items: BillItem[]) {
  const [reservation] = await db.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
  if (!reservation) throw new ExperienceBillError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
  if (reservation.reservationStatus !== "checked_in") {
    throw new ExperienceBillError("EXPERIENCE_NOT_ALLOWED", "Only checked-in reservations can add experiences");
  }
  if (!items.length || items.length > 30) throw new ExperienceBillError("INVALID_BILL", "Select 1 to 30 experience items", 400);
  if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1)) {
    throw new ExperienceBillError("INVALID_QUANTITY", "Experience quantity must be a positive integer", 400);
  }
  const variantIds = [...new Set(items.map((item) => item.variantId))];
  const catalog = await db.select({ variant: experienceVariants, experience: experiences })
    .from(experienceVariants).innerJoin(experiences, eq(experienceVariants.experienceId, experiences.id))
    .where(inArray(experienceVariants.id, variantIds));
  const byId = new Map(catalog.map((row) => [row.variant.id, row]));
  const existing = await db.select({ experienceId: reservationExperiences.experienceId, quantity: reservationExperiences.quantity })
    .from(reservationExperiences).where(eq(reservationExperiences.reservationId, reservationId));
  const quantityByExperience = new Map<string, number>();
  for (const item of existing) {
    quantityByExperience.set(item.experienceId, (quantityByExperience.get(item.experienceId) ?? 0) + item.quantity);
  }
  const lines = items.map((item) => {
    const selected = byId.get(item.variantId);
    if (!selected || !selected.experience.isActive) {
      throw new ExperienceBillError("INVALID_EXPERIENCE", "Experience variant not found or inactive", 400);
    }
    if (item.serviceDate && (item.serviceDate < reservation.checkInDate || item.serviceDate >= reservation.checkOutDate)) {
      throw new ExperienceBillError("INVALID_SERVICE_DATE", "Service date must be within the stay", 400);
    }
    const totalQuantity = (quantityByExperience.get(selected.experience.id) ?? 0) + item.quantity;
    if (totalQuantity > selected.experience.maxQuantity) {
      throw new ExperienceBillError("EXPERIENCE_LIMIT", `${selected.experience.name} allows at most ${selected.experience.maxQuantity} item(s)`, 400);
    }
    quantityByExperience.set(selected.experience.id, totalQuantity);
    const name = `${selected.experience.name} · ${selected.variant.subName}`;
    const amount = item.quantity * selected.variant.price;
    if (!Number.isSafeInteger(amount)) throw new ExperienceBillError("INVALID_TOTAL", "Experience total is too large", 400);
    return {
      variantId: selected.variant.id,
      experienceId: selected.experience.id,
      name,
      description: selected.variant.description,
      quantity: item.quantity,
      unitPrice: selected.variant.price,
      serviceDate: item.serviceDate ?? null,
      amount,
    };
  });
  const addedTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const financials = await readReservationFinancials(db, reservationId);
  return {
    reservationId, bookingCode: reservation.bookingCode, version: reservation.version,
    lines, addedTotal,
    bookingTotalBefore: financials.bookingTotal,
    bookingTotalAfter: financials.bookingTotal + addedTotal,
    paidAmount: financials.netPaidAmount,
    remainingBalanceAfter: Math.max(0, financials.bookingTotal + addedTotal - financials.netPaidAmount),
  };
}

export async function saveExperienceBill(tx: Transaction, input: {
  reservationId: string; expectedVersion: number; expectedAddedTotal: number; items: BillItem[]; actorUserId: string;
}) {
  const [reservation] = await tx.select().from(reservations)
    .where(eq(reservations.id, input.reservationId)).for("update").limit(1);
  if (!reservation) throw new ExperienceBillError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
  if (reservation.version !== input.expectedVersion) {
    throw new ExperienceBillError("RESERVATION_CHANGED", "Reservation changed. Review the bill again");
  }
  const quote = await quoteExperienceBill(tx, input.reservationId, input.items);
  if (quote.addedTotal !== input.expectedAddedTotal) {
    throw new ExperienceBillError("BILL_PRICE_CHANGED", "Experience prices changed. Review the bill again");
  }
  for (const line of quote.lines) {
    await tx.insert(reservationExperiences).values({
      reservationId: input.reservationId,
      experienceId: line.experienceId,
      nameSnapshot: line.name.slice(0, 160),
      descriptionSnapshot: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      serviceDate: line.serviceDate,
    });
    await tx.insert(reservationCharges).values({
      reservationId: input.reservationId,
      kind: "experience",
      sourceId: line.variantId,
      description: line.name,
      quantity: String(line.quantity),
      unitAmount: line.unitPrice,
      amount: line.amount,
      serviceDate: line.serviceDate,
      createdByUserId: input.actorUserId,
    });
  }
  const financials = await readReservationFinancials(tx, input.reservationId);
  const paymentStatus = financials.remainingBalance === 0 ? "paid" : financials.netPaidAmount > 0 ? "partial" : "unpaid";
  await tx.update(reservations).set({
    paymentStatus, version: sql`${reservations.version} + 1`, updatedAt: new Date(),
  }).where(eq(reservations.id, input.reservationId));
  await recordReservationEvent(tx, {
    reservationId: input.reservationId,
    eventType: "reservation.experience_bill_saved",
    actorType: "user",
    actorUserId: input.actorUserId,
    reservationStatusBefore: "checked_in",
    reservationStatusAfter: "checked_in",
    paymentStatusBefore: reservation.paymentStatus,
    paymentStatusAfter: paymentStatus,
    details: { lines: quote.lines.map((line) => ({ variantId: line.variantId, name: line.name, quantity: line.quantity, amount: line.amount })), addedTotal: quote.addedTotal, remainingBalance: financials.remainingBalance },
  });
  return { ...quote, paymentStatus, remainingBalance: financials.remainingBalance };
}
