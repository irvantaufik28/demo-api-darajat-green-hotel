import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import nodemailer from "nodemailer";
import { emailOutbox } from "../../../db/schema/email_outbox.schema.js";
import { buildReservationVoucherEmail } from "./reservation-voucher-email.service.js";

const MAX_ATTEMPTS = 5;

type ClaimedEmail = {
  id: string;
  reservationId: string;
  recipient: string;
  attemptCount: number;
};

async function claimEmails(app: FastifyInstance): Promise<ClaimedEmail[]> {
  const result = await app.db.execute(sql`
    with claimed as (
      select id
      from ${emailOutbox}
      where (
        (status = 'pending' and available_at <= now())
        or (status = 'processing' and locked_at < now() - interval '10 minutes')
      )
      order by available_at, created_at
      for update skip locked
      limit 10
    )
    update ${emailOutbox} as outbox
    set status = 'processing', locked_at = now(), updated_at = now()
    from claimed
    where outbox.id = claimed.id
    returning outbox.id, outbox.reservation_id, outbox.recipient, outbox.attempt_count
  `);
  return result.rows.map((row) => ({
    id: String(row.id),
    reservationId: String(row.reservation_id),
    recipient: String(row.recipient),
    attemptCount: Number(row.attempt_count),
  }));
}

export async function processEmailOutbox(app: FastifyInstance) {
  const config = app.authConfig.email;
  if (!config) return { processed: 0 };

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
  const jobs = await claimEmails(app);

  for (const job of jobs) {
    try {
      const email = await buildReservationVoucherEmail(app.db, config, job.reservationId);
      if (email.recipient.toLowerCase() !== job.recipient.toLowerCase()) {
        throw new Error("Guest email changed after the voucher was queued");
      }
      const result = await transporter.sendMail({
        from: { name: config.fromName, address: config.fromAddress },
        replyTo: config.replyTo,
        to: email.recipient,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: [email.attachment],
      });
      await app.db.execute(sql`
        update ${emailOutbox}
        set status = 'sent', sent_at = now(), locked_at = null,
            provider_message_id = ${result.messageId}, last_error = null, updated_at = now()
        where id = ${job.id}
      `);
    } catch (error) {
      const attemptCount = job.attemptCount + 1;
      const failed = attemptCount >= MAX_ATTEMPTS;
      const delayMinutes = Math.min(60, 2 ** attemptCount);
      const message = error instanceof Error ? error.message : "Unknown email delivery error";
      await app.db.execute(sql`
        update ${emailOutbox}
        set status = ${failed ? "failed" : "pending"}, attempt_count = ${attemptCount},
            available_at = now() + (${delayMinutes} * interval '1 minute'),
            locked_at = null, last_error = ${message.slice(0, 4000)}, updated_at = now()
        where id = ${job.id}
      `);
      app.log.error(
        { err: error, emailOutboxId: job.id, reservationId: job.reservationId, attemptCount },
        "Reservation voucher email delivery failed",
      );
    }
  }

  return { processed: jobs.length };
}
