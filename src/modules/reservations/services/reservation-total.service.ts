export type PricedRoom = {
  roomTypeId: string;
  extraBeds?: number;
  adultBreakfasts?: number;
  childBreakfasts?: number;
};

export type RoomAddOnRates = {
  extraBedEnabled: boolean;
  maxExtraBeds: number;
  extraBedPricePerNight: number;
  adultBreakfastPrice: number;
  childBreakfastPrice: number;
};

export type SelectedExperience = { variantId: string; quantity: number };
export type ExperienceRate = { name: string; unitPrice: number };

export class ReservationTotalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function calculateReservationTotal(input: {
  rooms: PricedRoom[];
  roomRates: Map<string, RoomAddOnRates>;
  roomNights: { roomIndex: number; finalPrice: number }[];
  nights: number;
  experiences: SelectedExperience[];
  experienceRates: Map<string, ExperienceRate>;
}) {
  const rooms = input.rooms.map((room, roomIndex) => {
    const rates = input.roomRates.get(room.roomTypeId);
    if (!rates) {
      throw new ReservationTotalError(
        "ROOM_UNAVAILABLE",
        `Room type ${room.roomTypeId} is unavailable`,
      );
    }
    const extraBeds = room.extraBeds ?? 0;
    if ((extraBeds > 0 && !rates.extraBedEnabled) || extraBeds > rates.maxExtraBeds) {
      throw new ReservationTotalError(
        "INVALID_EXTRA_BEDS",
        "Extra bed is not allowed for this room type",
      );
    }
    const roomAmount = input.roomNights
      .filter((night) => night.roomIndex === roomIndex)
      .reduce((sum, night) => sum + night.finalPrice, 0);
    const extraBedAmount = extraBeds * rates.extraBedPricePerNight * input.nights;
    const adultBreakfastAmount =
      (room.adultBreakfasts ?? 0) * rates.adultBreakfastPrice * input.nights;
    const childBreakfastAmount =
      (room.childBreakfasts ?? 0) * rates.childBreakfastPrice * input.nights;
    return {
      roomIndex,
      roomTypeId: room.roomTypeId,
      roomAmount,
      extraBeds,
      extraBedUnitPricePerNight: rates.extraBedPricePerNight,
      extraBedAmount,
      adultBreakfasts: room.adultBreakfasts ?? 0,
      adultBreakfastUnitPrice: rates.adultBreakfastPrice,
      adultBreakfastAmount,
      childBreakfasts: room.childBreakfasts ?? 0,
      childBreakfastUnitPrice: rates.childBreakfastPrice,
      childBreakfastAmount,
      subtotal: roomAmount + extraBedAmount + adultBreakfastAmount + childBreakfastAmount,
    };
  });
  const experiences = input.experiences.map((item) => {
    const rate = input.experienceRates.get(item.variantId);
    if (!rate) {
      throw new ReservationTotalError(
        "INVALID_EXPERIENCE",
        "Experience variant not found or inactive",
      );
    }
    return {
      variantId: item.variantId,
      name: rate.name,
      quantity: item.quantity,
      unitPrice: rate.unitPrice,
      amount: rate.unitPrice * item.quantity,
    };
  });
  const roomTotal = rooms.reduce((sum, room) => sum + room.roomAmount, 0);
  const extraBedTotal = rooms.reduce((sum, room) => sum + room.extraBedAmount, 0);
  const breakfastTotal = rooms.reduce(
    (sum, room) => sum + room.adultBreakfastAmount + room.childBreakfastAmount,
    0,
  );
  const experienceTotal = experiences.reduce((sum, item) => sum + item.amount, 0);
  const bookingTotal = roomTotal + extraBedTotal + breakfastTotal + experienceTotal;
  if (!Number.isSafeInteger(bookingTotal)) {
    throw new ReservationTotalError("INVALID_TOTAL", "Booking total is too large");
  }
  return {
    rooms,
    experiences,
    roomTotal,
    extraBedTotal,
    breakfastTotal,
    experienceTotal,
    bookingTotal,
  };
}
