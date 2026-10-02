import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { cancellationPolicies } from "../../db/schema/cancellation_policies.schema.js";
import { cancellationPolicyRoomTypes } from "../../db/schema/cancellation_policy_room_types.schema.js";
import { cancellationRules } from "../../db/schema/cancellation_rules.schema.js";
import { capacityPatterns } from "../../db/schema/capacity_patterns.schema.js";
import { experienceVariants } from "../../db/schema/experience_variants.schema.js";
import { experiences } from "../../db/schema/experiences.schema.js";
import { guests } from "../../db/schema/guests.schema.js";
import { masterItems } from "../../db/schema/master_items.schema.js";
import { payments } from "../../db/schema/payments.schema.js";
import { reservationCharges } from "../../db/schema/reservation_charges.schema.js";
import { reservationDeposits } from "../../db/schema/reservation_deposits.schema.js";
import { reservationExperiences } from "../../db/schema/reservation_experiences.schema.js";
import { reservationRoomExtraBeds } from "../../db/schema/reservation_room_extra_beds.schema.js";
import { reservationRoomNights } from "../../db/schema/reservation_room_nights.schema.js";
import { reservationRooms } from "../../db/schema/reservation_rooms.schema.js";
import { reservations } from "../../db/schema/reservations.schema.js";
import { roomInventoryDaily } from "../../db/schema/room_inventory_daily.schema.js";
import { roomTypeCapacityPatterns } from "../../db/schema/room_type_capacity_patterns.schema.js";
import { roomUnits } from "../../db/schema/room_units.schema.js";
import { databaseErrorCode, uuidSchema } from "../master/master.shared.js";
import { readRoomAvailability, stayDates } from "./reservations-availability.service.js";
import {
  bookingDateJakarta,
  InvalidPromoCodeError,
  priceRoomNights,
} from "./reservations-campaigns.service.js";
import {
  availabilityQuerySchema,
  createReservationBodySchema,
  reservationQuoteBodySchema,
  type CreateReservationBody,
  type ReservationQuoteBody,
} from "./reservations-create.schemas.js";

type AvailabilityQuery = {
  checkInDate: string;
  checkOutDate: string;
  roomTypeId?: string;
  adults?: number;
  children?: number;
};

class ReservationInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });
const nullable = (value: string | null | undefined) => value?.trim() || null;

export const reservationCreateRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: AvailabilityQuery }>(
    "/availability",
    {
      preHandler: app.requirePermission("reservations.create"),
      schema: { querystring: availabilityQuerySchema },
    },
    async (request, reply) => {
      const { checkInDate, checkOutDate, roomTypeId, adults, children } = request.query;
      if ((adults === undefined) !== (children === undefined)) {
        return reply
          .code(400)
          .send(errorBody("INVALID_GUEST_COUNT", "Provide both adults and children"));
      }
      const dates = stayDates(checkInDate, checkOutDate);
      if (!dates) {
        return reply
          .code(400)
          .send(errorBody("INVALID_STAY_DATES", "Use valid dates for a stay of 1 to 366 nights"));
      }
      const items = await readRoomAvailability(
        app.db,
        checkInDate,
        checkOutDate,
        dates,
        roomTypeId ? [roomTypeId] : undefined,
        adults === undefined || children === undefined ? undefined : { adults, children },
      );
      return {
        checkInDate,
        checkOutDate,
        adults: adults ?? null,
        children: children ?? null,
        nights: dates.length,
        items,
      };
    },
  );

  app.post<{ Body: ReservationQuoteBody }>(
    "/quote",
    {
      preHandler: app.requirePermission("reservations.create"),
      schema: { body: reservationQuoteBodySchema },
    },
    async (request, reply) => {
      const { source, checkInDate, checkOutDate, promoCode, rooms } = request.body;
      const dates = stayDates(checkInDate, checkOutDate);
      if (!dates) {
        return reply
          .code(400)
          .send(errorBody("INVALID_STAY_DATES", "Use valid dates for a stay of 1 to 366 nights"));
      }
      const roomCount = rooms.reduce((sum, room) => sum + room.quantity, 0);
      if (roomCount > 20) {
        return reply.code(400).send(errorBody("TOO_MANY_ROOMS", "Select at most 20 rooms"));
      }
      const requested = new Map<string, number>();
      for (const room of rooms) {
        requested.set(room.roomTypeId, (requested.get(room.roomTypeId) ?? 0) + room.quantity);
      }
      const options = await readRoomAvailability(app.db, checkInDate, checkOutDate, dates, [
        ...requested.keys(),
      ]);
      const byType = new Map(options.map((option) => [option.roomType.id, option]));
      for (const [roomTypeId, quantity] of requested) {
        const option = byType.get(roomTypeId);
        if (!option || !option.bookable || option.availableRooms < quantity) {
          return reply
            .code(409)
            .send(errorBody("ROOM_UNAVAILABLE", `Room type ${roomTypeId} is unavailable`));
        }
      }
      const selectedRooms = rooms.flatMap((room) =>
        Array.from({ length: room.quantity }, () => room.roomTypeId),
      );
      try {
        const price = await priceRoomNights(app.db, {
          source,
          promoCode,
          bookingDate: bookingDateJakarta(),
          nights: dates.length,
          roomCount,
          rows: selectedRooms.flatMap((roomTypeId, roomIndex) =>
            byType.get(roomTypeId)!.nightlyRates.map((night) => ({
              roomIndex,
              roomTypeId,
              stayDate: night.stayDate,
              basePrice: night.basePrice!,
            })),
          ),
        });
        return {
          checkInDate,
          checkOutDate,
          nights: dates.length,
          roomCount,
          ...price,
        };
      } catch (error) {
        if (error instanceof InvalidPromoCodeError) {
          return reply.code(400).send(errorBody("INVALID_PROMO_CODE", error.message));
        }
        throw error;
      }
    },
  );

  app.post<{ Body: CreateReservationBody }>(
    "/",
    {
      preHandler: app.requirePermission("reservations.create"),
      schema: { body: createReservationBodySchema },
    },
    async (request, reply) => {
      const body = request.body;
      const dates = stayDates(body.checkInDate, body.checkOutDate);
      if (!dates) {
        return reply
          .code(400)
          .send(errorBody("INVALID_STAY_DATES", "Use valid dates for a stay of 1 to 366 nights"));
      }
      if (Boolean(body.guestId) === Boolean(body.guest)) {
        return reply
          .code(400)
          .send(errorBody("INVALID_GUEST", "Provide either guestId or a new guest"));
      }
      if (body.guest && !body.guest.fullName.trim()) {
        return reply.code(400).send(errorBody("INVALID_GUEST", "Guest name is required"));
      }
      if (body.source === "walk_in" && body.cancellationPolicyId) {
        return reply
          .code(400)
          .send(
            errorBody("INVALID_POLICY", "Walk-in reservations do not use cancellation policies"),
          );
      }
      if (body.rooms.every((room) => room.adults === 0 && room.children === 0)) {
        return reply.code(400).send(errorBody("INVALID_ROOMS", "At least one guest is required"));
      }
      const assignedUnitIds = body.rooms
        .map((room) => room.roomUnitId)
        .filter((id): id is string => Boolean(id));
      if (new Set(assignedUnitIds).size !== assignedUnitIds.length) {
        return reply
          .code(400)
          .send(errorBody("DUPLICATE_ROOM", "A room number can only be assigned once"));
      }

      const requestedCounts = new Map<string, number>();
      for (const room of body.rooms) {
        requestedCounts.set(room.roomTypeId, (requestedCounts.get(room.roomTypeId) ?? 0) + 1);
      }
      const roomTypeIds = [...requestedCounts.keys()].sort();
      const bookingDate = bookingDateJakarta();

      try {
        const result = await app.db.transaction(async (tx) => {
          // Serialize bookings for each room type before reading occupied inventory.
          for (const roomTypeId of roomTypeIds) {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${roomTypeId}))`);
          }
          const inventoryRows = await tx
            .select()
            .from(roomInventoryDaily)
            .where(
              and(
                inArray(roomInventoryDaily.roomTypeId, roomTypeIds),
                gte(roomInventoryDaily.stayDate, dates[0]),
                lte(roomInventoryDaily.stayDate, dates[dates.length - 1]),
              ),
            )
            .for("update");
          const inventoryByKey = new Map(
            inventoryRows.map((row) => [`${row.roomTypeId}:${row.stayDate}`, row]),
          );
          const availability = await readRoomAvailability(
            tx,
            body.checkInDate,
            body.checkOutDate,
            dates,
            roomTypeIds,
          );
          const availabilityByType = new Map(availability.map((item) => [item.roomType.id, item]));
          for (const [roomTypeId, quantity] of requestedCounts) {
            const option = availabilityByType.get(roomTypeId);
            if (!option || !option.bookable || option.availableRooms < quantity) {
              throw new ReservationInputError(
                "ROOM_UNAVAILABLE",
                `Room type ${roomTypeId} is unavailable for the requested stay`,
                409,
              );
            }
          }

          const assignedUnits = assignedUnitIds.length
            ? await tx
                .select({
                  id: roomUnits.id,
                  roomTypeId: roomUnits.roomTypeId,
                  roomNumber: roomUnits.roomNumber,
                  bedConfiguration: roomUnits.bedConfiguration,
                  isActive: roomUnits.isActive,
                  operationalStatus: roomUnits.operationalStatus,
                })
                .from(roomUnits)
                .where(inArray(roomUnits.id, assignedUnitIds))
                .for("update")
            : [];
          const assignedById = new Map(assignedUnits.map((unit) => [unit.id, unit]));
          for (const room of body.rooms) {
            if (!room.roomUnitId) continue;
            const unit = assignedById.get(room.roomUnitId);
            if (
              !unit ||
              unit.roomTypeId !== room.roomTypeId ||
              !unit.isActive ||
              ["maintenance", "out_of_service"].includes(unit.operationalStatus) ||
              (body.checkInDate <= bookingDate && unit.operationalStatus !== "available")
            ) {
              throw new ReservationInputError(
                "ROOM_UNIT_UNAVAILABLE",
                `Assigned room ${room.roomUnitId} is unavailable for this room type`,
                409,
              );
            }
          }
          if (assignedUnitIds.length) {
            const overlapping = await tx
              .select({ roomUnitId: reservationRooms.roomUnitId })
              .from(reservationRooms)
              .innerJoin(reservations, eq(reservationRooms.reservationId, reservations.id))
              .where(
                and(
                  inArray(reservationRooms.roomUnitId, assignedUnitIds),
                  inArray(reservations.reservationStatus, ["pending", "confirmed", "checked_in"]),
                  sql`${reservations.checkInDate} < ${body.checkOutDate}`,
                  sql`${reservations.checkOutDate} > ${body.checkInDate}`,
                ),
              );
            if (overlapping.length) {
              throw new ReservationInputError(
                "ROOM_UNIT_UNAVAILABLE",
                "An assigned room is already reserved for the requested stay",
                409,
              );
            }
          }

          const capacities = await tx
            .select({
              roomTypeId: roomTypeCapacityPatterns.roomTypeId,
              adults: capacityPatterns.adults,
              children: capacityPatterns.children,
              extraBeds: roomTypeCapacityPatterns.extraBeds,
            })
            .from(roomTypeCapacityPatterns)
            .innerJoin(
              capacityPatterns,
              eq(roomTypeCapacityPatterns.capacityPatternId, capacityPatterns.id),
            )
            .where(
              and(
                inArray(roomTypeCapacityPatterns.roomTypeId, roomTypeIds),
                eq(capacityPatterns.isActive, true),
              ),
            );
          for (const room of body.rooms) {
            const option = availabilityByType.get(room.roomTypeId)!;
            const extraBeds = room.extraBeds ?? 0;
            if (
              (extraBeds > 0 && !option.roomType.extraBedEnabled) ||
              extraBeds > option.roomType.maxExtraBeds
            ) {
              throw new ReservationInputError(
                "INVALID_EXTRA_BEDS",
                "Extra bed is not allowed for this room type",
              );
            }
            if (
              !capacities.some(
                (capacity) =>
                  capacity.roomTypeId === room.roomTypeId &&
                  capacity.adults === room.adults &&
                  capacity.children === room.children &&
                  capacity.extraBeds <= extraBeds,
              )
            ) {
              throw new ReservationInputError(
                "INVALID_CAPACITY",
                "Guest count is not allowed for this room type",
              );
            }
          }

          const priced = await priceRoomNights(tx, {
            source: body.source,
            promoCode: body.promoCode,
            bookingDate,
            nights: dates.length,
            roomCount: body.rooms.length,
            rows: body.rooms.flatMap((room, roomIndex) =>
              dates.map((stayDate) => ({
                roomIndex,
                roomTypeId: room.roomTypeId,
                stayDate,
                basePrice: inventoryByKey.get(`${room.roomTypeId}:${stayDate}`)!.basePrice,
              })),
            ),
          });

          const methodIds = [body.payment?.methodId, body.deposit?.methodId].filter(
            (id): id is string => Boolean(id),
          );
          if (methodIds.length) {
            const methods = await tx
              .select({ id: masterItems.id })
              .from(masterItems)
              .where(
                and(
                  inArray(masterItems.id, methodIds),
                  eq(masterItems.category, "payment_methods"),
                  eq(masterItems.isActive, true),
                ),
              );
            if (new Set(methods.map((method) => method.id)).size !== new Set(methodIds).size) {
              throw new ReservationInputError(
                "INVALID_PAYMENT_METHOD",
                "Payment method not found or inactive",
              );
            }
          }

          const selectedVariants = body.experiences?.length
            ? await tx
                .select({ variant: experienceVariants, experience: experiences })
                .from(experienceVariants)
                .innerJoin(experiences, eq(experienceVariants.experienceId, experiences.id))
                .where(
                  inArray(
                    experienceVariants.id,
                    body.experiences.map((item) => item.variantId),
                  ),
                )
            : [];
          const variantById = new Map(selectedVariants.map((row) => [row.variant.id, row]));
          for (const item of body.experiences ?? []) {
            const row = variantById.get(item.variantId);
            if (!row || !row.experience.isActive) {
              throw new ReservationInputError(
                "INVALID_EXPERIENCE",
                "Experience variant not found or inactive",
              );
            }
            if (
              item.serviceDate &&
              (!stayDates(item.serviceDate, body.checkOutDate) ||
                item.serviceDate < body.checkInDate ||
                item.serviceDate >= body.checkOutDate)
            ) {
              throw new ReservationInputError(
                "INVALID_SERVICE_DATE",
                "Experience date must fall within the stay",
              );
            }
          }

          let cancellationPolicyId: string | null = null;
          let cancellationPolicySnapshot: unknown = null;
          if (body.source === "phone") {
            const selectedPolicyId =
              body.cancellationPolicyId ??
              priced.appliedCampaigns.find((campaign) => campaign.cancellationPolicyId)
                ?.cancellationPolicyId;
            if (selectedPolicyId) {
              const [policy] = await tx
                .select()
                .from(cancellationPolicies)
                .where(
                  and(
                    eq(cancellationPolicies.id, selectedPolicyId),
                    eq(cancellationPolicies.isActive, true),
                    eq(cancellationPolicies.appliesPhone, true),
                  ),
                )
                .limit(1);
              if (
                !policy ||
                (policy.stayStart && policy.stayStart > body.checkInDate) ||
                (policy.stayEnd && policy.stayEnd < dates[dates.length - 1])
              ) {
                throw new ReservationInputError(
                  "INVALID_POLICY",
                  "Phone cancellation policy is unavailable for this stay",
                );
              }
              const [rules, applicableRooms] = await Promise.all([
                tx
                  .select()
                  .from(cancellationRules)
                  .where(eq(cancellationRules.policyId, policy.id)),
                tx
                  .select({ roomTypeId: cancellationPolicyRoomTypes.roomTypeId })
                  .from(cancellationPolicyRoomTypes)
                  .where(eq(cancellationPolicyRoomTypes.policyId, policy.id)),
              ]);
              if (
                applicableRooms.length &&
                roomTypeIds.some(
                  (id) => !applicableRooms.some((applicable) => applicable.roomTypeId === id),
                )
              ) {
                throw new ReservationInputError(
                  "INVALID_POLICY",
                  "Cancellation policy does not apply to all selected rooms",
                );
              }
              cancellationPolicyId = policy.id;
              cancellationPolicySnapshot = { policy, rules };
            } else {
              cancellationPolicySnapshot = {
                name: "100% cancellation charge",
                type: "non_refundable",
                chargeType: "percentage",
                chargeValue: 100,
              };
            }
          }

          let bookingTotal = priced.roomTotal;
          for (const room of body.rooms) {
            const option = availabilityByType.get(room.roomTypeId)!;
            bookingTotal +=
              (room.extraBeds ?? 0) * option.roomType.extraBedPricePerNight * dates.length;
            bookingTotal +=
              (room.adultBreakfasts ?? 0) * option.roomType.adultBreakfastPrice * dates.length;
            bookingTotal +=
              (room.childBreakfasts ?? 0) * option.roomType.childBreakfastPrice * dates.length;
          }
          for (const item of body.experiences ?? []) {
            bookingTotal += variantById.get(item.variantId)!.variant.price * item.quantity;
          }
          if (
            !Number.isSafeInteger(bookingTotal) ||
            (body.payment && body.payment.amount > bookingTotal)
          ) {
            throw new ReservationInputError("INVALID_PAYMENT", "Payment exceeds the booking total");
          }

          let guestId = body.guestId;
          if (guestId) {
            const [existing] = await tx
              .select({ id: guests.id })
              .from(guests)
              .where(eq(guests.id, guestId))
              .limit(1);
            if (!existing) throw new ReservationInputError("GUEST_NOT_FOUND", "Guest not found");
          } else {
            const [created] = await tx
              .insert(guests)
              .values({
                fullName: body.guest!.fullName.trim(),
                phone: nullable(body.guest!.phone),
                email: nullable(body.guest!.email),
              })
              .returning({ id: guests.id });
            guestId = created.id;
          }

          const id = randomUUID();
          const bookingCode = `GH-${id.replaceAll("-", "").slice(0, 12).toUpperCase()}`;
          const paidAmount = body.payment?.amount ?? 0;
          const paymentStatus =
            paidAmount === 0 ? "unpaid" : paidAmount === bookingTotal ? "paid" : "partial";
          const reservationStatus = body.confirm ? "confirmed" : "pending";
          await tx.insert(reservations).values({
            id,
            bookingCode,
            guestId,
            source: body.source,
            checkInDate: body.checkInDate,
            checkOutDate: body.checkOutDate,
            adults: body.rooms.reduce((sum, room) => sum + room.adults, 0),
            children: body.rooms.reduce((sum, room) => sum + room.children, 0),
            reservationStatus,
            paymentStatus,
            promoCodeSnapshot: priced.promoCodeSnapshot,
            cancellationPolicyId,
            cancellationPolicySnapshot,
            specialRequests: nullable(body.specialRequests),
            internalNotes: nullable(body.internalNotes),
            confirmedAt: body.confirm ? new Date() : null,
            createdByUserId: request.authUser!.id,
          });

          for (const [roomIndex, room] of body.rooms.entries()) {
            const option = availabilityByType.get(room.roomTypeId)!;
            const roomNights = priced.rows.filter((night) => night.roomIndex === roomIndex);
            const roomTotal = roomNights.reduce((sum, night) => sum + night.finalPrice, 0);
            const [createdRoom] = await tx
              .insert(reservationRooms)
              .values({
                reservationId: id,
                roomTypeId: room.roomTypeId,
                roomUnitId: room.roomUnitId ?? null,
                roomTypeNameSnapshot: option.roomType.name,
                adults: room.adults,
                children: room.children,
                bedConfigurationSnapshot: room.roomUnitId
                  ? assignedById.get(room.roomUnitId)!.bedConfiguration
                  : null,
              })
              .returning({ id: reservationRooms.id });
            await tx.insert(reservationRoomNights).values(
              roomNights.map((night) => ({
                reservationRoomId: createdRoom.id,
                stayDate: night.stayDate,
                basePrice: night.basePrice,
                discountAmount: night.discountAmount,
                finalPrice: night.finalPrice,
                campaignId: night.campaignId,
              })),
            );
            await tx.insert(reservationCharges).values({
              reservationId: id,
              reservationRoomId: createdRoom.id,
              kind: "room",
              description: `${option.roomType.name} · ${dates.length} night(s)`,
              quantity: "1",
              unitAmount: roomTotal,
              amount: roomTotal,
              createdByUserId: request.authUser!.id,
            });
            if (room.extraBeds) {
              const amount = room.extraBeds * option.roomType.extraBedPricePerNight * dates.length;
              await tx.insert(reservationRoomExtraBeds).values({
                reservationRoomId: createdRoom.id,
                quantity: room.extraBeds,
                dateFrom: body.checkInDate,
                dateTo: body.checkOutDate,
                unitPricePerNight: option.roomType.extraBedPricePerNight,
              });
              await tx.insert(reservationCharges).values({
                reservationId: id,
                reservationRoomId: createdRoom.id,
                kind: "extra_bed",
                description: `${room.extraBeds} extra bed(s) · ${option.roomType.name}`,
                quantity: String(room.extraBeds * dates.length),
                unitAmount: option.roomType.extraBedPricePerNight,
                amount,
                createdByUserId: request.authUser!.id,
              });
            }
            for (const [label, quantity, unitAmount] of [
              ["Adult breakfast", room.adultBreakfasts ?? 0, option.roomType.adultBreakfastPrice],
              ["Child breakfast", room.childBreakfasts ?? 0, option.roomType.childBreakfastPrice],
            ] as const) {
              if (!quantity) continue;
              await tx.insert(reservationCharges).values({
                reservationId: id,
                reservationRoomId: createdRoom.id,
                kind: "breakfast",
                description: `${label} · ${option.roomType.name}`,
                quantity: String(quantity * dates.length),
                unitAmount,
                amount: quantity * unitAmount * dates.length,
                createdByUserId: request.authUser!.id,
              });
            }
          }

          for (const item of body.experiences ?? []) {
            const selected = variantById.get(item.variantId)!;
            const name = `${selected.experience.name} · ${selected.variant.subName}`;
            await tx.insert(reservationExperiences).values({
              reservationId: id,
              experienceId: selected.experience.id,
              nameSnapshot: name.slice(0, 160),
              descriptionSnapshot: selected.variant.description,
              quantity: item.quantity,
              unitPrice: selected.variant.price,
              serviceDate: item.serviceDate ?? null,
            });
            await tx.insert(reservationCharges).values({
              reservationId: id,
              kind: "experience",
              sourceId: selected.variant.id,
              description: name,
              quantity: String(item.quantity),
              unitAmount: selected.variant.price,
              amount: selected.variant.price * item.quantity,
              serviceDate: item.serviceDate ?? null,
              createdByUserId: request.authUser!.id,
            });
          }
          if (body.payment) {
            await tx.insert(payments).values({
              reservationId: id,
              methodId: body.payment.methodId,
              amount: body.payment.amount,
              status: "succeeded",
              paidAt: new Date(),
              notes: nullable(body.payment.notes),
              recordedByUserId: request.authUser!.id,
            });
          }
          if (body.deposit) {
            await tx.insert(reservationDeposits).values({
              reservationId: id,
              methodId: body.deposit.methodId,
              amountHeld: body.deposit.amount,
              notes: nullable(body.deposit.notes),
            });
          }
          return {
            id,
            bookingCode,
            reservationStatus,
            paymentStatus,
            bookingTotal,
            discountTotal: priced.discountTotal,
            appliedCampaigns: priced.appliedCampaigns,
            rooms: body.rooms.map((room) => ({
              roomTypeId: room.roomTypeId,
              roomUnitId: room.roomUnitId ?? null,
              roomNumber: room.roomUnitId ? assignedById.get(room.roomUnitId)!.roomNumber : null,
              adults: room.adults,
              children: room.children,
              extraBeds: room.extraBeds ?? 0,
              adultBreakfasts: room.adultBreakfasts ?? 0,
              childBreakfasts: room.childBreakfasts ?? 0,
            })),
            experiences: (body.experiences ?? []).map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
              serviceDate: item.serviceDate ?? null,
              unitPrice: variantById.get(item.variantId)!.variant.price,
            })),
            paidAmount,
            remainingBalance: bookingTotal - paidAmount,
            payment: body.payment
              ? { methodId: body.payment.methodId, amount: body.payment.amount }
              : null,
            deposit: body.deposit
              ? { methodId: body.deposit.methodId, amountHeld: body.deposit.amount }
              : null,
          };
        });
        return reply.code(201).send({ reservation: result });
      } catch (error) {
        if (error instanceof InvalidPromoCodeError) {
          return reply.code(400).send(errorBody("INVALID_PROMO_CODE", error.message));
        }
        if (error instanceof ReservationInputError) {
          return reply.code(error.statusCode).send(errorBody(error.code, error.message));
        }
        if (databaseErrorCode(error) === "23503") {
          return reply
            .code(400)
            .send(errorBody("INVALID_REFERENCE", "A referenced item is unavailable"));
        }
        if (databaseErrorCode(error) === "23505") {
          return reply
            .code(409)
            .send(errorBody("DUPLICATE_RESERVATION", "Reservation conflicts with existing data"));
        }
        throw error;
      }
    },
  );
};
