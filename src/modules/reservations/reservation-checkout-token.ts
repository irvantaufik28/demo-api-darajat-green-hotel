import { createHmac, timingSafeEqual } from "node:crypto";

export function createCheckoutToken(reservationId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`website-checkout:${reservationId}`)
    .digest("base64url");
}

export function verifyCheckoutToken(reservationId: string, token: string, secret: string): boolean {
  const expected = Buffer.from(createCheckoutToken(reservationId, secret));
  const received = Buffer.from(token);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
