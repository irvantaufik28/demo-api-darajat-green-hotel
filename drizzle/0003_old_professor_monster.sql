CREATE TYPE "greenhero"."deposit_status" AS ENUM('held', 'partially_refunded', 'refunded', 'deducted');--> statement-breakpoint
CREATE TYPE "greenhero"."reservation_payment_status" AS ENUM('unpaid', 'partial', 'paid', 'failed', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "greenhero"."reservation_status" AS ENUM('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired');--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_deposits" DROP CONSTRAINT "reservation_deposits_amount_status_check";--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" DROP CONSTRAINT "reservations_status_check";--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" DROP CONSTRAINT "reservations_payment_status_check";--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" DROP CONSTRAINT "reservations_operational_status_check";--> statement-breakpoint
DROP INDEX "greenhero"."reservations_operational_payment_idx";--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_deposits" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_deposits" ALTER COLUMN "status" SET DATA TYPE "greenhero"."deposit_status" USING "status"::"greenhero"."deposit_status";--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_deposits" ALTER COLUMN "status" SET DEFAULT 'held'::"greenhero"."deposit_status";--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ALTER COLUMN "reservation_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ALTER COLUMN "reservation_status" SET DATA TYPE "greenhero"."reservation_status" USING "reservation_status"::"greenhero"."reservation_status";--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ALTER COLUMN "reservation_status" SET DEFAULT 'pending'::"greenhero"."reservation_status";--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ALTER COLUMN "payment_status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ALTER COLUMN "payment_status" SET DATA TYPE "greenhero"."reservation_payment_status" USING "payment_status"::"greenhero"."reservation_payment_status";--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" ALTER COLUMN "payment_status" SET DEFAULT 'unpaid'::"greenhero"."reservation_payment_status";--> statement-breakpoint
CREATE INDEX "reservations_payment_status_idx" ON "greenhero"."reservations" USING btree ("payment_status");--> statement-breakpoint
ALTER TABLE "greenhero"."reservations" DROP COLUMN "operational_status";--> statement-breakpoint
ALTER TABLE "greenhero"."reservation_deposits" ADD CONSTRAINT "reservation_deposits_amount_status_check" CHECK ("greenhero"."reservation_deposits"."amount_held" >= 0 and "greenhero"."reservation_deposits"."amount_refunded" >= 0 and "greenhero"."reservation_deposits"."amount_deducted" >= 0 and "greenhero"."reservation_deposits"."amount_refunded" + "greenhero"."reservation_deposits"."amount_deducted" <= "greenhero"."reservation_deposits"."amount_held");
