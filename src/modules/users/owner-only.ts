import type { FastifyReply, FastifyRequest } from "fastify";

export async function requireOwner(request: FastifyRequest, reply: FastifyReply) {
  if (request.authUser?.roleName !== "Owner") {
    return reply.code(403).send({
      error: { code: "FORBIDDEN", message: "Owner access required" },
    });
  }
}
