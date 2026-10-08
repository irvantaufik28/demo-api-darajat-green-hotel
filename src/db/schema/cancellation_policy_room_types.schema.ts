import { primaryKey, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { cancellationPolicies } from "./cancellation_policies.schema.js";
import { roomTypes } from "./room_types.schema.js";

import { appSchema } from "./app-schema.js";

export const cancellationPolicyRoomTypes = appSchema.table(
  "cancellation_policy_room_types",
  {
    policyId: uuid("policy_id")
      .notNull()
      .references(() => cancellationPolicies.id, { onDelete: "cascade" }),
    roomTypeId: uuid("room_type_id")
      .notNull()
      .references(() => roomTypes.id),
  },
  (table) => [
    primaryKey({ columns: [table.policyId, table.roomTypeId] }),
    uniqueIndex("cancellation_policy_room_types_room_type_uq").on(table.roomTypeId),
  ],
);
