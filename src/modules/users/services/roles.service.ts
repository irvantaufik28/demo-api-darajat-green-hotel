import { asc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { permissions } from "../../../db/schema/permissions.schema.js";
import { rolePermissions } from "../../../db/schema/role_permissions.schema.js";
import { roles } from "../../../db/schema/roles.schema.js";

const roleFields = {
  id: roles.id,
  name: roles.name,
  description: roles.description,
  isSystem: roles.isSystem,
  isActive: roles.isActive,
};

export function listPermissions(app: FastifyInstance) {
  return app.db
    .select({
      id: permissions.id,
      code: permissions.code,
      module: permissions.module,
      label: permissions.label,
    })
    .from(permissions)
    .orderBy(asc(permissions.module), asc(permissions.label));
}

export async function listRoles(app: FastifyInstance) {
  const rows = await app.db
    .select({ ...roleFields, permissionCode: permissions.code })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .leftJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .orderBy(asc(roles.name));

  const byRole = new Map<
    string,
    Omit<(typeof rows)[number], "permissionCode"> & {
      permissionCodes: string[];
    }
  >();
  for (const { permissionCode, ...role } of rows) {
    let entry = byRole.get(role.id);
    if (!entry) {
      entry = { ...role, permissionCodes: [] };
      byRole.set(role.id, entry);
    }
    if (permissionCode) entry.permissionCodes.push(permissionCode);
  }
  return [...byRole.values()].map((role) => ({
    ...role,
    permissionCodes: role.permissionCodes.sort(),
  }));
}

export async function getRole(app: FastifyInstance, id: string) {
  return (await listRoles(app)).find((role) => role.id === id);
}

export async function roleNameExists(app: FastifyInstance, name: string) {
  const [existing] = await app.db
    .select({ id: roles.id })
    .from(roles)
    .where(sql`lower(${roles.name}) = ${name.toLowerCase()}`)
    .limit(1);
  return Boolean(existing);
}

export async function createRole(app: FastifyInstance, name: string) {
  const [role] = await app.db
    .insert(roles)
    .values({ name, isSystem: false, isActive: true })
    .returning(roleFields);
  return { ...role, permissionCodes: [] as string[] };
}

export async function replaceRolePermissions(
  app: FastifyInstance,
  roleId: string,
  permissionCodes: string[],
) {
  const selected = permissionCodes.length
    ? await app.db
        .select({ id: permissions.id, code: permissions.code })
        .from(permissions)
        .where(inArray(permissions.code, permissionCodes))
    : [];
  if (selected.length !== new Set(permissionCodes).size) return null;

  await app.db.transaction(async (tx) => {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (selected.length) {
      await tx
        .insert(rolePermissions)
        .values(selected.map((permission) => ({ roleId, permissionId: permission.id })));
    }
    await tx.update(roles).set({ updatedAt: new Date() }).where(eq(roles.id, roleId));
  });
  return getRole(app, roleId);
}
