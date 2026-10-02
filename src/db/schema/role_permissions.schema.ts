import { primaryKey, uuid } from "drizzle-orm/pg-core";
import { permissions } from "./permissions.schema.js";
import { roles } from "./roles.schema.js";

import { appSchema } from "./app-schema.js";

export const rolePermissions = appSchema.table(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);
