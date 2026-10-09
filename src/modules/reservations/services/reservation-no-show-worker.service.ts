import { and, eq, isNull, sql } from "drizzle-orm";
import { reservationSettings } from "../../../db/schema/reservation_settings.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import type { Database } from "../../../plugins/database.js";
import { markReservationNoShow, NoShowError } from "./reservation-no-show.service.js";

const SETTINGS_ID = "00000000-0000-4000-8000-000000000001";
const BATCH_SIZE = 50;

export async function processAutomaticNoShows(db: Database) {
  const [settings] = await db
    .select({
      mode: reservationSettings.noShowMode,
      cutoffTime: reservationSettings.noShowCutoffTime,
    })
    .from(reservationSettings)
    .where(eq(reservationSettings.id, SETTINGS_ID))
    .limit(1);
  const mode = settings?.mode ?? "automatic";
  const cutoffTime = settings?.cutoffTime ?? "06:00:00";
  if (mode !== "automatic") return { processed: 0, skipped: 0, mode };

  const candidates = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.reservationStatus, "confirmed"),
        isNull(reservations.checkedInAt),
        sql`((${reservations.checkInDate} + ${cutoffTime}::time + interval '1 day') at time zone 'Asia/Jakarta') <= now()`,
      ),
    )
    .orderBy(reservations.checkInDate, reservations.id)
    .limit(BATCH_SIZE);

  let processed = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    try {
      await db.transaction((tx) =>
        markReservationNoShow(tx, {
          reservationId: candidate.id,
          reason: `Automatically marked no-show after ${cutoffTime.slice(0, 5)} WIB cut-off`,
          actorType: "system",
        }),
      );
      processed += 1;
    } catch (error) {
      if (error instanceof NoShowError) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }
  return { processed, skipped, mode, cutoffTime };
}
