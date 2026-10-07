import multipart from "@fastify/multipart";
import type { FastifyPluginAsync } from "fastify";
import {
  UnsupportedUploadTypeError,
  uploadToCloudinary,
} from "../services/cloudinary-upload.service.js";

const MAX_UPLOAD_BYTES = 4_000_000;
const errorBody = (code: string, message: string) => ({ error: { code, message } });

function cloudinaryAuthFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as {
    message?: unknown;
    http_code?: unknown;
    error?: { message?: unknown; http_code?: unknown };
  };
  const message = failure.error?.message ?? failure.message;
  const status = failure.error?.http_code ?? failure.http_code;
  return (
    status === 401 ||
    (typeof message === "string" &&
      /api_secret mismatch|invalid api[_ ]key|invalid signature|invalid credentials/i.test(message))
  );
}

function cloudinaryPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const failure = error as {
    http_code?: unknown;
    status?: unknown;
    error?: { http_code?: unknown; status?: unknown };
  };
  return (
    failure.error?.http_code === 403 ||
    failure.error?.status === 403 ||
    failure.http_code === 403 ||
    failure.status === 403
  );
}

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 0, parts: 1 },
  });

  app.post(
    "/",
    {
      preHandler: app.requireAnyPermission(["reservations.edit", "web_settings.manage"]),
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      if (!app.authConfig.cloudinary) {
        return reply
          .code(503)
          .send(errorBody("UPLOAD_NOT_CONFIGURED", "Cloudinary is not configured"));
      }
      if (!request.headers["content-type"]?.startsWith("multipart/form-data")) {
        return reply.code(415).send(errorBody("INVALID_CONTENT_TYPE", "Use multipart/form-data"));
      }

      let file;
      let buffer: Buffer;
      try {
        file = await request.file();
        if (!file)
          return reply
            .code(400)
            .send(errorBody("FILE_REQUIRED", "Upload a file in the file field"));
        if (file.fieldname !== "file") {
          return reply.code(400).send(errorBody("INVALID_FILE_FIELD", "Use the file field"));
        }
        buffer = await file.toBuffer();
      } catch (error) {
        if (error instanceof app.multipartErrors.RequestFileTooLargeError) {
          return reply.code(413).send(errorBody("FILE_TOO_LARGE", "Maximum file size is 4 MB"));
        }
        if (
          error instanceof app.multipartErrors.FilesLimitError ||
          error instanceof app.multipartErrors.FieldsLimitError ||
          error instanceof app.multipartErrors.PartsLimitError
        ) {
          return reply.code(400).send(errorBody("INVALID_UPLOAD", "Upload exactly one file"));
        }
        throw error;
      }

      if (buffer.length === 0) {
        return reply.code(400).send(errorBody("EMPTY_FILE", "The uploaded file is empty"));
      }

      try {
        const result = await uploadToCloudinary(buffer, app.authConfig.cloudinary);
        return reply.code(201).send({
          file: {
            assetId: result.asset_id,
            publicId: result.public_id,
            url: result.secure_url,
            resourceType: result.resource_type,
            format: result.format,
            bytes: result.bytes,
            width: result.width ?? null,
            height: result.height ?? null,
            originalName: file.filename.split(/[\\/]/).pop(),
          },
        });
      } catch (error) {
        if (error instanceof UnsupportedUploadTypeError) {
          return reply.code(415).send(errorBody("UNSUPPORTED_FILE_TYPE", error.message));
        }
        if (cloudinaryAuthFailed(error)) {
          request.log.error("Cloudinary rejected the configured credentials");
          return reply
            .code(503)
            .send(
              errorBody(
                "UPLOAD_CREDENTIALS_INVALID",
                "Check the Cloudinary credentials configured on the API",
              ),
            );
        }
        if (cloudinaryPermissionDenied(error)) {
          request.log.error("Cloudinary denied permission to create an asset");
          return reply
            .code(503)
            .send(
              errorBody(
                "UPLOAD_PERMISSION_DENIED",
                "Cloudinary denied upload permission for this product environment",
              ),
            );
        }
        request.log.error("Cloudinary upload failed");
        return reply.code(502).send(errorBody("UPLOAD_FAILED", "File upload failed"));
      }
    },
  );
};
