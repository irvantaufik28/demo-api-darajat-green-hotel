import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { permissions } from "../../../db/schema/permissions.schema.js";
import { reservationRooms } from "../../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../../db/schema/reservations.schema.js";
import { rolePermissions } from "../../../db/schema/role_permissions.schema.js";
import { roomUnits } from "../../../db/schema/room_units.schema.js";
import { uuidSchema } from "../../master/master.shared.js";
import { recordReservationEvent } from "../services/reservation-events.service.js";
import {
  DepositSettlementError,
  settleCheckoutDeposits,
  validateCheckoutDeposits,
  type CheckoutDepositDecision,
} from "../reservation-deposit-settlement.service.js";
import { readReservationFinancials } from "../services/reservation-financials.service.js";
import { getCheckOutWarning } from "../reservation-status.js";

type CheckOutParams = { id: string };
type CheckOutBody = {
  acknowledgeOutstanding?: boolean;
  outstandingReason?: string;
  deposits?: CheckoutDepositDecision[];
};

const paramsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: uuidSchema },
} as const;

const bodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    acknowledgeOutstanding: { type: "boolean" },
    outstandingReason: { type: "string", maxLength: 2000 },
    deposits: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["depositId"],
        properties: {
          depositId: uuidSchema,
          refundAmount: { type: "integer", minimum: 0, maximum: 9007199254740991 },
          deductionAmount: { type: "integer", minimum: 0, maximum: 9007199254740991 },
          deductionPurpose: { type: "string", enum: ["balance", "damage"] },
          deferRemaining: { type: "boolean" },
          reason: { type: "string", maxLength: 2000 },
          refundReference: { type: "string", maxLength: 160 },
        },
      },
    },
  },
} as const;

class CheckOutInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export const reservationCheckOutRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: CheckOutParams; Body: CheckOutBody }>(
    "/:id/check-out",
    {
      preHandler: app.requirePermission("reservations.check_out"),
      schema: { params: paramsSchema, body: bodySchema },
    },
    async (request, reply) => {
      try {
        const result = await app.db.transaction(async (tx) => {
          const [reservation] = await tx
            .select()
            .from(reservations)
            .where(eq(reservations.id, request.params.id))
            .for("update")
            .limit(1);
          if (!reservation) {
            throw new CheckOutInputError("RESERVATION_NOT_FOUND", "Reservation not found", 404);
          }

          const [financialsBefore, bookedRooms] = await Promise.all([
            readReservationFinancials(tx, reservation.id),
            tx
              .select({ id: reservationRooms.id, roomUnitId: reservationRooms.roomUnitId })
              .from(reservationRooms)
              .where(eq(reservationRooms.reservationId, reservation.id)),
          ]);
          if (reservation.reservationStatus !== "checked_in") {
            throw new CheckOutInputError(
              "CHECK_OUT_NOT_ALLOWED",
              "Only checked-in reservations can be checked out",
            );
          }

          const depositDecisions = request.body?.deposits ?? [];
          validateCheckoutDeposits(financialsBefore, depositDecisions);
          if (depositDecisions.some((decision) => (decision.refundAmount ?? 0) > 0)) {
            const [refundPermission] = await tx
              .select({ id: permissions.id })
              .from(rolePermissions)
              .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
              .where(
                and(
                  eq(rolePermissions.roleId, request.authUser!.roleId),
                  eq(permissions.code, "payments.refund"),
                ),
              )
              .limit(1);
            if (!refundPermission) {
              throw new CheckOutInputError(
                "DEPOSIT_REFUND_FORBIDDEN",
                "Permission to refund a deposit is required",
                403,
              );
            }
          }
          const depositOutcomes = await settleCheckoutDeposits(tx, {
            reservationId: reservation.id,
            actorUserId: request.authUser!.id,
            reservationStatus: "checked_in",
            paymentStatus: reservation.paymentStatus,
            financials: financialsBefore,
            decisions: depositDecisions,
          });
          const financials = await readReservationFinancials(tx, reservation.id);
          const { bookingTotal, remainingBalance, depositBalance } = financials;
          const paidAmount = financials.netPaidAmount;
          const paymentStatus =
            remainingBalance === 0 ? "paid" : paidAmount > 0 ? "partial" : "unpaid";
          const warning = getCheckOutWarning(reservation.reservationStatus, remainingBalance);

          const outstandingReason = request.body?.outstandingReason?.trim() ?? "";
          if (warning === "outstanding") {
            if (request.body?.acknowledgeOutstanding !== true || !outstandingReason) {
              throw new CheckOutInputError(
                "OUTSTANDING_CONFIRMATION_REQUIRED",
                "Confirm the outstanding balance and provide a reason before checkout",
              );
            }
            const [overridePermission] = await tx
              .select({ id: permissions.id })
              .from(rolePermissions)
              .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
              .where(
                and(
                  eq(rolePermissions.roleId, request.authUser!.roleId),
                  eq(permissions.code, "reservations.checkout_outstanding_override"),
                ),
              )
              .limit(1);
            if (!overridePermission) {
              throw new CheckOutInputError(
                "OUTSTANDING_OVERRIDE_FORBIDDEN",
                "Permission to check out with an outstanding balance is required",
                403,
              );
            }
          }

          const roomUnitIds = bookedRooms
            .map((room) => room.roomUnitId)
            .filter((id): id is string => Boolean(id));
          if (roomUnitIds.length) {
            await tx
              .update(roomUnits)
              .set({ operationalStatus: "cleaning", updatedAt: new Date() })
              .where(
                and(
                  inArray(roomUnits.id, roomUnitIds),
                  notInArray(roomUnits.operationalStatus, ["maintenance", "out_of_service"]),
                ),
              );
          }

          const checkedOutAt = new Date();
          await tx
            .update(reservations)
            .set({
              reservationStatus: "checked_out",
              paymentStatus,
              checkedOutAt,
              checkoutOutstandingReason: warning === "outstanding" ? outstandingReason : null,
              version: sql`${reservations.version} + 1`,
              updatedAt: checkedOutAt,
            })
            .where(eq(reservations.id, reservation.id));

          await recordReservationEvent(tx, {
            reservationId: reservation.id,
            eventType: "guest.checked_out",
            actorType: "user",
            actorUserId: request.authUser!.id,
            occurredAt: checkedOutAt,
            reservationStatusBefore: reservation.reservationStatus,
            reservationStatusAfter: "checked_out",
            paymentStatusBefore: reservation.paymentStatus,
            paymentStatusAfter: paymentStatus,
            details: {
              bookingTotal,
              paidAmount,
              remainingBalance,
              outstandingReason: warning === "outstanding" ? outstandingReason : null,
              depositBalance,
              depositOutcomes,
              roomUnitIds,
            },
          });

          return {
            reservationId: reservation.id,
            bookingCode: reservation.bookingCode,
            reservationStatus: "checked_out" as const,
            paymentStatus,
            checkedOutAt,
            bookingTotal,
            paidAmount,
            remainingBalance,
            checkoutOutstandingReason: warning === "outstanding" ? outstandingReason : null,
            depositBalance,
            depositOutcomes,
            roomUnitIds,
          };
        });
        return result;
      } catch (error) {
        if (error instanceof CheckOutInputError || error instanceof DepositSettlementError) {
          return reply.code(error.statusCode).send({
            error: { code: error.code, message: error.message },
          });
        }
        throw error;
      }
    },
  );
};
