import { and, eq } from "drizzle-orm";
import { reservationEvents } from "../../../db/schema/reservation_events.schema.js";
import type { Database } from "../../../plugins/database.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function getNoRefundDecision(db: Database | Transaction, reservationId: string) {
  const [decision] = await db
    .select({ occurredAt: reservationEvents.occurredAt, details: reservationEvents.details })
    .from(reservationEvents)
    .where(
      and(
        eq(reservationEvents.reservationId, reservationId),
        eq(reservationEvents.eventType, "payment.no_refund"),
      ),
    )
    .limit(1);
  return decision ?? null;
}
