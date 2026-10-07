import { timingSafeEqual } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { processXenditWebhook, XenditWebhookError } from "../services/xendit-webhook.service.js";

function matchesToken(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export const xenditWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.post("/xendit", async (request, reply) => {
    const config = app.authConfig.xendit;
    if (!config) {
      return reply
        .code(503)
        .send({ error: { code: "XENDIT_NOT_CONFIGURED", message: "Xendit is not configured" } });
    }
    const token = request.headers["x-callback-token"];
    if (!matchesToken(typeof token === "string" ? token : undefined, config.webhookToken)) {
      return reply
        .code(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Invalid webhook token" } });
    }
    try {
      return reply.code(200).send(await processXenditWebhook(app.db, request.body));
    } catch (error) {
      if (error instanceof XenditWebhookError) {
        return reply
          .code(error.statusCode)
          .send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
};
