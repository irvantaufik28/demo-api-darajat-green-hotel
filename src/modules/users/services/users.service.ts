import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { roles } from "../../../db/schema/roles.schema.js";
import { users } from "../../../db/schema/users.schema.js";
import { hashPassword } from "../../auth/password.js";

export type CreateUserInput = {
  name: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  roleId: string;
  password: string;
  isActive: boolean;
};

const userFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  phone: users.phone,
  roleId: users.roleId,
  roleName: roles.name,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
};

export function listUsers(app: FastifyInstance) {
  return app.db
    .select(userFields)
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .orderBy(asc(users.name), asc(users.id));
}

export function listActiveRoles(app: FastifyInstance) {
  return app.db
    .select({ id: roles.id, name: roles.name })
    .from(roles)
    .where(eq(roles.isActive, true))
    .orderBy(asc(roles.name));
}

export async function getUser(app: FastifyInstance, id: string) {
  const [user] = await app.db
    .select(userFields)
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1);
  return user;
}

export async function createUser(app: FastifyInstance, input: CreateUserInput) {
  const passwordHash = await hashPassword(input.password);
  const [created] = await app.db
    .insert(users)
    .values({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      username: input.username?.trim() || null,
      phone: input.phone?.trim() || null,
      roleId: input.roleId,
      passwordHash,
      isActive: input.isActive,
    })
    .returning({ id: users.id });
  return getUser(app, created.id);
}

export async function setUserStatus(app: FastifyInstance, id: string, isActive: boolean) {
  const [updated] = await app.db
    .update(users)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  return updated ? getUser(app, id) : undefined;
}
