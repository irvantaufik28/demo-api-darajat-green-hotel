export type AppConfig = {
  nodeEnv: "development" | "production" | "test";
  host: string;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  xendit: {
    apiBaseUrl: string;
    secretKey: string;
    webhookToken: string;
    websiteBaseUrl: string;
  } | null;
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
    folder: string;
  } | null;
};

const environments = ["development", "production", "test"] as const;
const logLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

function parseCloudinaryUrl(value: string): {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
} {
  try {
    const url = new URL(value);
    if (url.protocol !== "cloudinary:" || !url.hostname || !url.username || !url.password) {
      throw new Error();
    }
    return {
      cloudName: url.hostname,
      apiKey: decodeURIComponent(url.username),
      apiSecret: decodeURIComponent(url.password),
    };
  } catch {
    throw new Error("CLOUDINARY_URL must use cloudinary://<api_key>:<api_secret>@<cloud_name>");
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = environment.NODE_ENV ?? "development";
  const host = environment.HOST ?? "127.0.0.1";
  const port = Number(environment.PORT ?? "4000");
  const logLevel = environment.LOG_LEVEL ?? "info";
  const databaseUrl = environment.DATABASE_URL;
  const jwtSecret = environment.JWT_SECRET;
  const corsOrigins = (environment.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const xenditApiBaseUrl = environment.XENDIT_API_BASE_URL?.trim() ?? "";
  const xenditSecretKey = environment.XENDIT_SECRET_KEY?.trim() ?? "";
  const xenditWebhookToken = environment.XENDIT_WEBHOOK_TOKEN?.trim() ?? "";
  const websiteBaseUrl = environment.WEBSITE_BASE_URL?.trim() ?? "";
  const cloudinaryUrl = environment.CLOUDINARY_URL?.trim();
  const cloudinaryCredentials = cloudinaryUrl ? parseCloudinaryUrl(cloudinaryUrl) : null;
  const cloudName =
    cloudinaryCredentials?.cloudName ?? environment.CLOUDINARY_CLOUD_NAME?.trim() ?? "";
  const apiKey = cloudinaryCredentials?.apiKey ?? environment.CLOUDINARY_API_KEY?.trim() ?? "";
  const apiSecret =
    cloudinaryCredentials?.apiSecret ?? environment.CLOUDINARY_API_SECRET?.trim() ?? "";
  const folder = environment.CLOUDINARY_UPLOAD_FOLDER?.trim() || "greenhero";

  if (!environments.includes(nodeEnv as AppConfig["nodeEnv"])) {
    throw new Error("NODE_ENV must be development, production, or test");
  }
  if (!host.trim()) {
    throw new Error("HOST must not be empty");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  if (!logLevels.includes(logLevel as AppConfig["logLevel"])) {
    throw new Error("LOG_LEVEL is invalid");
  }
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  if (corsOrigins.length === 0 || corsOrigins.some((origin) => !/^https?:\/\//.test(origin))) {
    throw new Error("CORS_ORIGINS must contain HTTP or HTTPS origins");
  }
  if (
    [xenditApiBaseUrl, xenditSecretKey, xenditWebhookToken, websiteBaseUrl].some(Boolean) &&
    ![xenditApiBaseUrl, xenditSecretKey, xenditWebhookToken, websiteBaseUrl].every(Boolean)
  ) {
    throw new Error(
      "XENDIT_API_BASE_URL, XENDIT_SECRET_KEY, XENDIT_WEBHOOK_TOKEN, and WEBSITE_BASE_URL must be set together",
    );
  }
  if (xenditApiBaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(xenditApiBaseUrl);
    } catch {
      throw new Error("XENDIT_API_BASE_URL must be an absolute HTTPS origin");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("XENDIT_API_BASE_URL must be an HTTPS origin without a path");
    }
  }
  if (websiteBaseUrl) {
    let parsed: URL;
    try {
      parsed = new URL(websiteBaseUrl);
    } catch {
      throw new Error("WEBSITE_BASE_URL must be an absolute URL");
    }
    const isLocalDevelopment =
      nodeEnv !== "production" &&
      parsed.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (
      !(parsed.protocol === "https:" || isLocalDevelopment) ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        "WEBSITE_BASE_URL must be an HTTPS origin (HTTP localhost is allowed outside production)",
      );
    }
  }
  if (
    [cloudName, apiKey, apiSecret].some(Boolean) &&
    ![cloudName, apiKey, apiSecret].every(Boolean)
  ) {
    throw new Error(
      "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be set together",
    );
  }
  if (!/^[a-zA-Z0-9_/-]+$/.test(folder) || folder.startsWith("/") || folder.endsWith("/")) {
    throw new Error("CLOUDINARY_UPLOAD_FOLDER contains invalid characters");
  }

  return {
    nodeEnv: nodeEnv as AppConfig["nodeEnv"],
    host,
    port,
    logLevel: logLevel as AppConfig["logLevel"],
    databaseUrl,
    jwtSecret,
    corsOrigins,
    xendit: xenditSecretKey
      ? {
          apiBaseUrl: xenditApiBaseUrl,
          secretKey: xenditSecretKey,
          webhookToken: xenditWebhookToken,
          websiteBaseUrl,
        }
      : null,
    cloudinary: cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret, folder } : null,
  };
}
