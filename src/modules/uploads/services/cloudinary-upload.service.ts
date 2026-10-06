import { randomUUID } from "node:crypto";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";
import { fileTypeFromBuffer } from "file-type";
import type { AppConfig } from "../../../config/env.js";

const allowedTypes = new Map([
  ["image/jpeg", { kind: "image", extension: "jpg" }],
  ["image/png", { kind: "image", extension: "png" }],
  ["image/webp", { kind: "image", extension: "webp" }],
  ["application/pdf", { kind: "document", extension: "pdf" }],
] as const);

export class UnsupportedUploadTypeError extends Error {}

export async function uploadToCloudinary(
  buffer: Buffer,
  config: NonNullable<AppConfig["cloudinary"]>,
): Promise<UploadApiResponse> {
  const detected = await fileTypeFromBuffer(buffer);
  const fileType =
    detected &&
    allowedTypes.get(
      detected.mime as "image/jpeg" | "image/png" | "image/webp" | "application/pdf",
    );

  if (!fileType) {
    throw new UnsupportedUploadTypeError("Only JPEG, PNG, WebP, and PDF files are supported");
  }

  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });

  const isImage = fileType.kind === "image";
  return new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `${config.folder}/${isImage ? "images" : "documents"}`,
        resource_type: isImage ? "image" : "raw",
        public_id: isImage ? randomUUID() : `${randomUUID()}.${fileType.extension}`,
        overwrite: false,
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary returned no upload result"));
          return;
        }
        resolve(result);
      },
    );
    stream.end(buffer);
  });
}
