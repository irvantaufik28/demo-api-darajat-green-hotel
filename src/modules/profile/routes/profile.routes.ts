import type { FastifyPluginAsync } from "fastify";
import { getProfile, updateProfile } from "../services/profile.service.js";
import { updateProfileSchema, type UpdateProfileBody } from "../schemas/profile.schema.js";

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: app.authenticate }, async (request, reply) => {
    const profile = await getProfile(app, request.authUser!.id);
    if (!profile) return reply.code(404).send(errorBody("NOT_FOUND", "Profile not found"));
    return { profile };
  });

  app.patch<{ Body: UpdateProfileBody }>(
    "/",
    { preHandler: app.authenticate, schema: { body: updateProfileSchema } },
    async (request, reply) => {
      const profile = await updateProfile(app, request.authUser!.id, request.body);
      if (!profile) return reply.code(404).send(errorBody("NOT_FOUND", "Profile not found"));
      return { profile };
    },
  );
};
