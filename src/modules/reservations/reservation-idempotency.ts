import { createHash } from "node:crypto";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function requestHash(body: Record<string, unknown>): string {
  const { idempotencyKey: _key, ...payload } = body;
  return createHash("sha256")
    .update(JSON.stringify(stableValue(payload)))
    .digest("hex");
}
