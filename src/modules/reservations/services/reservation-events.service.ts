import type { Database } from "../../../plugins/database.js";
import { reservationEvents } from "../../../db/schema/reservation_events.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type ReservationStatus = typeof reservations.$inferSelect.reservationStatus;
type PaymentStatus = typeof reservations.$inferSelect.paymentStatus;

export type ReservationEventInput = {
  reservationId: string;
  eventType: string;
  actorType: "user" | "system" | "gateway";
  actorUserId?: string | null;
  occurredAt?: Date;
  reservationStatusBefore?: ReservationStatus | null;
  reservationStatusAfter?: ReservationStatus | null;
  paymentStatusBefore?: PaymentStatus | null;
  paymentStatusAfter?: PaymentStatus | null;
  referenceId?: string | null;
  details?: Record<string, unknown>;
};

export async function recordReservationEvent(
  tx: Transaction,
  input: ReservationEventInput,
): Promise<void> {
  await tx.insert(reservationEvents).values({
    reservationId: input.reservationId,
    eventType: input.eventType,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    reservationStatusBefore: input.reservationStatusBefore ?? null,
    reservationStatusAfter: input.reservationStatusAfter ?? null,
    paymentStatusBefore: input.paymentStatusBefore ?? null,
    paymentStatusAfter: input.paymentStatusAfter ?? null,
    referenceId: input.referenceId ?? null,
    details: input.details ?? {},
  });
}
