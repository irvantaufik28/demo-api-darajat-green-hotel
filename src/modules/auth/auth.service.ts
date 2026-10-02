import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { permissions } from "../../db/schema/permissions.schema.js";
import { rolePermissions } from "../../db/schema/role_permissions.schema.js";
import { roles } from "../../db/schema/roles.schema.js";
import { userSessions } from "../../db/schema/user_sessions.schema.js";
import { users } from "../../db/schema/users.schema.js";
import { verifyPassword } from "./password.js";

export const ACCESS_TOKEN_TTL_SECONDS = 5 * 60;
export const SESSION_TTL_SECONDS = 15 * 60;

type Account = {
  id: string;
  roleId: string;
  name: string;
  email: string;
  roleName: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionExpiresAt: Date;
  user: Account & { permissions: string[] };
};

function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getRolePermissions(app: FastifyInstance, roleId: string): Promise<string[]> {
  const rows = await app.db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleId))
    .orderBy(permissions.code);
  return rows.map(({ code }) => code);
}

export async function authenticateCredentials(
  app: FastifyInstance,
  identifier: string,
  password: string,
): Promise<Account | null> {
  const normalized = identifier.trim().toLowerCase();
  const [account] = await app.db
    .select({
      id: users.id,
      roleId: users.roleId,
      name: users.name,
      email: users.email,
      roleName: roles.name,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      roleIsActive: roles.isActive,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(
      or(sql`lower(${users.email}) = ${normalized}`, sql`lower(${users.username}) = ${normalized}`),
    )
    .limit(1);

  if (!account || !(await verifyPassword(account.passwordHash, password))) return null;
  if (!account.isActive || !account.roleIsActive) return null;

  const { id, roleId, name, email, roleName } = account;
  return { id, roleId, name, email, roleName };
}

export async function issueSession(app: FastifyInstance, account: Account): Promise<AuthSession> {
  const sessionId = randomUUID();
  const refreshToken = newRefreshToken();
  const sessionExpiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await app.db.transaction(async (transaction) => {
    await transaction.insert(userSessions).values({
      id: sessionId,
      userId: account.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: sessionExpiresAt,
    });
    await transaction
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, account.id));
  });

  const accessToken = app.jwt.sign(
    { sub: account.id, sid: sessionId },
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  );
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    sessionExpiresAt,
    user: { ...account, permissions: await getRolePermissions(app, account.roleId) },
  };
}

export async function rotateSession(
  app: FastifyInstance,
  refreshToken: string,
): Promise<AuthSession | null> {
  const tokenHash = hashRefreshToken(refreshToken);
  const [session] = await app.db
    .select({
      sessionId: userSessions.id,
      sessionExpiresAt: userSessions.expiresAt,
      id: users.id,
      roleId: users.roleId,
      name: users.name,
      email: users.email,
      roleName: roles.name,
    })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(
      and(
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
        eq(users.isActive, true),
        eq(roles.isActive, true),
      ),
    )
    .limit(1);

  if (!session) return null;

  const replacement = newRefreshToken();
  const [rotated] = await app.db
    .update(userSessions)
    .set({ tokenHash: hashRefreshToken(replacement) })
    .where(
      and(
        eq(userSessions.id, session.sessionId),
        eq(userSessions.tokenHash, tokenHash),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, new Date()),
      ),
    )
    .returning({ id: userSessions.id });

  if (!rotated) return null;

  const accessToken = app.jwt.sign(
    { sub: session.id, sid: session.sessionId },
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  );
  const account: Account = {
    id: session.id,
    roleId: session.roleId,
    name: session.name,
    email: session.email,
    roleName: session.roleName,
  };
  return {
    accessToken,
    refreshToken: replacement,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    sessionExpiresAt: session.sessionExpiresAt,
    user: { ...account, permissions: await getRolePermissions(app, account.roleId) },
  };
}

export async function revokeSession(app: FastifyInstance, refreshToken: string): Promise<void> {
  await app.db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessions.tokenHash, hashRefreshToken(refreshToken)),
        isNull(userSessions.revokedAt),
      ),
    );
}
