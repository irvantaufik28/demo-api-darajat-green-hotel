import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { cancellationPolicies } from "./cancellation_policies.schema.js";
import { roomTypes } from "./room_types.schema.js";

export const cancellationPolicyRoomTypes = pgTable(
  "cancellation_policy_room_types",
  {
    policyId: uuid("policy_id")
      .notNull()
      .references(() => cancellationPolicies.id, { onDelete: "cascade" }),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id),
  },
  (table) => [primaryKey({ columns: [table.policyId, table.roomTypeId] })],
);
