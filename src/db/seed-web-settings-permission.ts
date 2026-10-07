import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { permissions } from "./schema/permissions.schema.js";
import { rolePermissions } from "./schema/role_permissions.schema.js";
import { roles } from "./schema/roles.schema.js";

const permission = {
  code: "web_settings.manage",
  module: "Web Settings",
  label: "Manage Web Settings",
};

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool });

  try {
    await db.transaction(async (tx) => {
      const [saved] = await tx
        .insert(permissions)
        .values(permission)
        .onConflictDoUpdate({
          target: permissions.code,
          set: { module: permission.module, label: permission.label },
        })
        .returning({ id: permissions.id });

      const allowedRoles = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(inArray(roles.name, ["Owner", "Manager", "Admin"]));

      for (const role of allowedRoles) {
        await tx
          .insert(rolePermissions)
          .values({ roleId: role.id, permissionId: saved.id })
          .onConflictDoNothing();
      }
    });

    console.info("Web Settings permission seeded for existing Owner, Manager, and Admin roles.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error("Web Settings permission seed failed:", error);
  process.exitCode = 1;
});
