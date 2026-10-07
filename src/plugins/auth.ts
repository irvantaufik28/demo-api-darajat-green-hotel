import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppConfig } from "../config/env.js";
import { permissions } from "../db/schema/permissions.schema.js";
import { rolePermissions } from "../db/schema/role_permissions.schema.js";
import { roles } from "../db/schema/roles.schema.js";
import { userSessions } from "../db/schema/user_sessions.schema.js";
import { users } from "../db/schema/users.schema.js";

export type AuthenticatedUser = {
  id: string;
  roleId: string;
  name: string;
  email: string;
  roleName: string;
  photoUrl: string | null;
};

declare module "fastify" {
  interface FastifyInstance {
    authConfig: AppConfig;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      code: string,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAnyPermission: (
      codes: string[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Authentication required" } };

export function registerAuth(app: FastifyInstance, config: AppConfig): void {
  app.register(cookie);
  app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  app.register(jwt, { secret: config.jwtSecret });
  app.register(rateLimit, { global: false });
  app.decorate("authConfig", config);

  app.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    let payload: { sub?: string; sid?: string };
    try {
      payload = await request.jwtVerify<{ sub: string; sid: string }>();
    } catch {
      reply.code(401).send(unauthorized);
      return;
    }

    if (!payload.sub || !payload.sid) {
      reply.code(401).send(unauthorized);
      return;
    }

    const [account] = await app.db
      .select({
        id: users.id,
        roleId: users.roleId,
        name: users.name,
        email: users.email,
        roleName: roles.name,
        photoUrl: users.photoUrl,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(
        and(
          eq(userSessions.id, payload.sid),
          eq(users.id, payload.sub),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
          eq(users.isActive, true),
          eq(roles.isActive, true),
        ),
      )
      .limit(1);

    if (!account) {
      reply.code(401).send(unauthorized);
      return;
    }
    request.authUser = account;
  });

  app.decorate("requirePermission", (code: string) => async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent || !request.authUser) return;

    const [granted] = await app.db
      .select({ id: permissions.id })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(and(eq(rolePermissions.roleId, request.authUser.roleId), eq(permissions.code, code)))
      .limit(1);

    if (!granted) {
      reply.code(403).send({ error: { code: "FORBIDDEN", message: "Permission denied" } });
    }
  });

  app.decorate("requireAnyPermission", (codes: string[]) => async (request, reply) => {
    await app.authenticate(request, reply);
    if (reply.sent || !request.authUser) return;

    const [granted] = await app.db
      .select({ id: permissions.id })
      .from(rolePermissions)
      .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
      .where(
        and(eq(rolePermissions.roleId, request.authUser.roleId), inArray(permissions.code, codes)),
      )
      .limit(1);

    if (!granted) {
      reply.code(403).send({ error: { code: "FORBIDDEN", message: "Permission denied" } });
    }
  });
}
