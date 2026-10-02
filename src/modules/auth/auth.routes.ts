import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { AppConfig } from "../../config/env.js";
import {
  authenticateCredentials,
  getRolePermissions,
  issueSession,
  revokeSession,
  rotateSession,
  type AuthSession,
} from "./auth.service.js";

type LoginBody = {
  identifier: string;
  password: string;
};

const refreshCookieName = "gh_refresh";
const refreshCookiePath = "/api/v1/admin/auth";
const invalidCredentials = {
  error: { code: "INVALID_CREDENTIALS", message: "Invalid email, username, or password" },
};
const unauthorized = { error: { code: "UNAUTHORIZED", message: "Session expired" } };

function cookieOptions(config: AppConfig, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: config.nodeEnv === "production" ? ("none" as const) : ("strict" as const),
    path: refreshCookiePath,
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  };
}

function allowedOrigin(request: FastifyRequest, config: AppConfig): boolean {
  return !request.headers.origin || config.corsOrigins.includes(request.headers.origin);
}

function responseBody(session: AuthSession) {
  return {
    accessToken: session.accessToken,
    tokenType: "Bearer",
    expiresIn: session.expiresIn,
    sessionExpiresAt: session.sessionExpiresAt.toISOString(),
    user: session.user,
  };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: LoginBody }>(
    "/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["identifier", "password"],
          additionalProperties: false,
          properties: {
            identifier: { type: "string", minLength: 1, maxLength: 255 },
            password: { type: "string", minLength: 1, maxLength: 1024 },
          },
        },
      },
    },
    async (request, reply) => {
      if (!allowedOrigin(request, app.authConfig)) {
        return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Origin denied" } });
      }

      const account = await authenticateCredentials(
        app,
        request.body.identifier,
        request.body.password,
      );
      if (!account) return reply.code(401).send(invalidCredentials);

      const session = await issueSession(app, account);
      reply.header("Cache-Control", "no-store");
      reply.setCookie(
        refreshCookieName,
        session.refreshToken,
        cookieOptions(app.authConfig, session.sessionExpiresAt),
      );
      return responseBody(session);
    },
  );

  app.post("/refresh", async (request, reply) => {
    if (!allowedOrigin(request, app.authConfig)) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Origin denied" } });
    }

    const token = request.cookies[refreshCookieName];
    if (!token) return reply.code(401).send(unauthorized);

    const session = await rotateSession(app, token);
    if (!session) {
      reply.clearCookie(refreshCookieName, { path: refreshCookiePath });
      return reply.code(401).send(unauthorized);
    }

    reply.header("Cache-Control", "no-store");
    reply.setCookie(
      refreshCookieName,
      session.refreshToken,
      cookieOptions(app.authConfig, session.sessionExpiresAt),
    );
    return responseBody(session);
  });

  app.post("/logout", async (request, reply) => {
    if (!allowedOrigin(request, app.authConfig)) {
      return reply.code(403).send({ error: { code: "FORBIDDEN", message: "Origin denied" } });
    }

    const token = request.cookies[refreshCookieName];
    if (token) await revokeSession(app, token);
    return reply.clearCookie(refreshCookieName, { path: refreshCookiePath }).code(204).send();
  });

  app.get("/me", { preHandler: app.authenticate }, async (request) => {
    const user = request.authUser!;
    return { user: { ...user, permissions: await getRolePermissions(app, user.roleId) } };
  });
};
