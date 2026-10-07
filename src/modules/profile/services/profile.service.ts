import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { roles } from "../../../db/schema/roles.schema.js";
import { users } from "../../../db/schema/users.schema.js";

const profileFields = {
  id: users.id,
  name: users.name,
  email: users.email,
  username: users.username,
  phone: users.phone,
  photoUrl: users.photoUrl,
  roleId: users.roleId,
  roleName: roles.name,
  isActive: users.isActive,
  lastLoginAt: users.lastLoginAt,
};

export type UpdateProfileInput = {
  name?: string;
  phone?: string | null;
  photoUrl?: string | null;
};

export async function getProfile(app: FastifyInstance, userId: string) {
  const [profile] = await app.db
    .select(profileFields)
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId))
    .limit(1);
  return profile;
}

export async function updateProfile(
  app: FastifyInstance,
  userId: string,
  input: UpdateProfileInput,
) {
  const changes: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) changes.name = input.name.trim();
  if (input.phone !== undefined) changes.phone = input.phone?.trim() || null;
  if (input.photoUrl !== undefined) changes.photoUrl = input.photoUrl?.trim() || null;

  const [updated] = await app.db
    .update(users)
    .set(changes)
    .where(eq(users.id, userId))
    .returning({ id: users.id });

  return updated ? getProfile(app, userId) : undefined;
}
