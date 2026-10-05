import type { FastifyPluginAsync } from "fastify";
import { databaseErrorCode } from "../../master/master.shared.js";
import { requireOwner } from "../owner-only.js";
import {
  createRole,
  getRole,
  listPermissions,
  listRoles,
  replaceRolePermissions,
  roleNameExists,
} from "../services/roles.service.js";
import {
  createRoleSchema,
  roleIdParamsSchema,
  updateRolePermissionsSchema,
  type CreateRoleBody,
  type UpdateRolePermissionsBody,
} from "../schemas/roles.schema.js";

type IdParams = { id: string };

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const roleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requirePermission("master.view"), requireOwner] }, async () => ({
    items: await listRoles(app),
  }));

  app.get(
    "/permissions",
    { preHandler: [app.requirePermission("master.view"), requireOwner] },
    async () => ({ items: await listPermissions(app) }),
  );

  app.get<{ Params: IdParams }>(
    "/:id",
    {
      preHandler: [app.requirePermission("master.view"), requireOwner],
      schema: { params: roleIdParamsSchema },
    },
    async (request, reply) => {
      const role = await getRole(app, request.params.id);
      return role ? { role } : reply.code(404).send(errorBody("NOT_FOUND", "Role not found"));
    },
  );

  app.post<{ Body: CreateRoleBody }>(
    "/",
    {
      preHandler: [app.requirePermission("master.create"), requireOwner],
      schema: { body: createRoleSchema },
    },
    async (request, reply) => {
      const name = request.body.name.trim();
      if (name.length < 2) {
        return reply
          .code(400)
          .send(errorBody("INVALID_NAME", "Role name must contain at least 2 characters"));
      }
      if (await roleNameExists(app, name)) {
        return reply.code(409).send(errorBody("DUPLICATE_ROLE", "Role name already exists"));
      }
      try {
        return reply.code(201).send({ role: await createRole(app, name) });
      } catch (error) {
        if (databaseErrorCode(error) === "23505") {
          return reply.code(409).send(errorBody("DUPLICATE_ROLE", "Role name already exists"));
        }
        throw error;
      }
    },
  );

  app.put<{ Params: IdParams; Body: UpdateRolePermissionsBody }>(
    "/:id/permissions",
    {
      preHandler: [app.requirePermission("master.edit"), requireOwner],
      schema: { params: roleIdParamsSchema, body: updateRolePermissionsSchema },
    },
    async (request, reply) => {
      const existing = await getRole(app, request.params.id);
      if (!existing) return reply.code(404).send(errorBody("NOT_FOUND", "Role not found"));
      if (
        existing.name === "Owner" &&
        !["master.view", "master.create", "master.edit"].every((code) =>
          request.body.permissionCodes.includes(code),
        )
      ) {
        return reply
          .code(409)
          .send(errorBody("OWNER_ACCESS_REQUIRED", "Owner must retain master access permissions"));
      }
      const role = await replaceRolePermissions(app, existing.id, request.body.permissionCodes);
      if (!role)
        return reply.code(400).send(errorBody("INVALID_PERMISSION", "Unknown permission code"));
      return { role };
    },
  );
};
