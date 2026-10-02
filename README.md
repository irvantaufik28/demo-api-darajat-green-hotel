# Green Hero Darajat API

Fastify + TypeScript API for the Green Hero admin and booking website.

## Requirements

- Node.js 24 or newer
- npm

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

The server listens at `http://127.0.0.1:4000` by default. Check `GET /api/v1/health` for a basic process health response. The API requires a PostgreSQL connection at startup. Configure `DATABASE_URL`, `JWT_SECRET` (at least 32 characters), and the comma-separated `CORS_ORIGINS` in `.env`. The local `.env` is ignored by Git.

## Deploy to Vercel

1. Import this repository into Vercel. If it is inside a monorepo, set the project Root Directory to `greenhero-api`. Vercel detects the Fastify entry point at `src/server.ts`; leave Framework Preset, Build Command, and Output Directory at their automatic settings. Node.js 24 is pinned in `package.json`.
2. Configure `DATABASE_URL` (a PostgreSQL server reachable from Vercel), `JWT_SECRET` (at least 32 random characters), and `CORS_ORIGINS` (the exact HTTPS origin of the admin frontend; separate multiple origins with commas) in Vercel Environment Variables. Do not copy the local `localhost` database URL or `.env` to Vercel.
3. Apply database migrations to that database separately with `npm run db:migrate`, then seed an initial account if needed with `npm run db:seed` and `SEED_USER_PASSWORD`. Neither command runs during a Vercel build.
4. Deploy and check `GET /api/v1/health` on the deployed URL. Set the admin frontend API base URL to the deployed origin. Place the API and admin on custom subdomains of the same site when using browser refresh cookies.

The Vercel function uses a small PostgreSQL pool per instance. Keep the deployment region close to the database and use a provider or pooler suitable for serverless connections. The production refresh cookie uses `Secure`, `HttpOnly`, and `SameSite=None` for cross-origin admin requests; the frontend must send credentials and its origin must be listed in `CORS_ORIGINS`.

## Admin authentication

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/admin/auth/login` | Login with `identifier` (email or username) and `password` |
| `POST` | `/api/v1/admin/auth/refresh` | Rotate the refresh cookie and issue a new access token |
| `POST` | `/api/v1/admin/auth/logout` | Revoke the current refresh session |
| `GET` | `/api/v1/admin/auth/me` | Return the authenticated user and permissions |

Login returns a Bearer access token in JSON and sets the `gh_refresh` cookie. Keep the access token in client memory and send it as `Authorization: Bearer <token>` on protected requests. Browser requests to refresh and logout must include credentials. The refresh token is stored only as a SHA-256 hash in `user_sessions`, rotated on use, and expires after 15 minutes; the access token expires after 5 minutes. The refresh cookie is HttpOnly. It uses Secure and SameSite None in production for a separately hosted admin frontend; local HTTP development uses SameSite Strict without Secure. Login is limited to five attempts per minute per IP.

Admin route handlers can use `preHandler: app.authenticate` or `preHandler: app.requirePermission("reservations.check_in")`. The guard checks the JWT, active session, active user and role, then resolves the permission through `roles`, `role_permissions`, and `permissions`. User passwords must be created with the Argon2id helper in `src/modules/auth/password.ts`. Login requires an existing active user with a valid role in the database; this change does not create a default account.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API with file watching |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server |
| `npm run typecheck` | Check TypeScript without output |
| `npm run db:generate` | Generate SQL migration from the Drizzle schema |
| `npm run db:migrate` | Apply pending migrations to `DATABASE_URL` |
| `npm run db:studio` | Open Drizzle Studio for the configured database |
| `npm run db:seed` | Seed admin roles, permissions, and users from the static admin data |
| `npm run format` | Format TypeScript and configuration with Prettier |
| `npm run format:check` | Check Prettier formatting |

## Database schema

Each table has its own file under `src/db/schema/`, named `<table_name>.schema.ts`. `columns.ts` holds shared column builders, and `index.ts` exports the 34 tables for Drizzle. The schema follows the supplied PostgreSQL database design, including foreign keys, status checks, and partial unique indexes.

`drizzle.config.ts` reads `DATABASE_URL` from `.env`. Generated SQL and Drizzle snapshots live in `drizzle/`. The initial migration is `drizzle/0000_serious_warlock.sql`. Review migrations before running `npm run db:migrate`, because that command changes the configured database. The initial migration has been generated but is not applied automatically.

## Seed admin access

Run migrations first. Set a temporary `SEED_USER_PASSWORD` of at least 5 characters in your local `.env`, then run `npm run db:seed`. The seed creates the five roles and five users shown in the admin's static data, along with its permission matrix. It can be rerun: matching records are updated, while passwords for existing users are preserved. Every newly created user receives the provided password. The seeded `deni@greenhero.id` account is inactive, matching the admin data. Remove `SEED_USER_PASSWORD` from `.env` when it is no longer needed.

## Structure

```text
src/
  create-app.ts             Fastify instance and application plugins
  server.ts                 Process startup and graceful shutdown
  routes/
    index.ts                Versioned route registration
    public/
      index.ts              /api/v1/public route group
    admin/
      index.ts              /api/v1/admin route group
  config/
    env.ts                  Environment parsing and validation
  db/
    schema/
      <table_name>.schema.ts One table per file
      columns.ts            Shared column builders
      index.ts              Schema exports
  modules/
    auth/
    reservations/
    rooms/
    payments/
    guests/
    reports/
    users/
    health/
      health.routes.ts      Existing health route
  plugins/
    database.ts             PostgreSQL pool and Drizzle integration
    auth.ts                 JWT, session, and permission guards
    swagger.ts              OpenAPI integration point
  common/
    errors/
    utils/
    types/
```

Keep each module's routes, request schemas, service logic, and data access together. Register website routes in `src/routes/public/index.ts` and admin routes in `src/routes/admin/index.ts`. `src/routes/index.ts` applies their prefixes and keeps the health endpoint at `/api/v1/health`. The database plugin is registered on the root Fastify instance and exposes `app.db` (Drizzle) and `app.pgPool` (node-postgres); it checks connectivity during startup and closes the pool during shutdown. `common/` is for code reused by multiple modules, not domain logic. Imports use `.js` suffixes because the project compiles as Node ESM.
