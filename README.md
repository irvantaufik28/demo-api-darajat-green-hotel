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
2. Configure `DATABASE_URL` (a PostgreSQL server reachable from Vercel), `JWT_SECRET` (at least 32 random characters), and `CORS_ORIGINS` (the exact HTTPS origin of the admin frontend; separate multiple origins with commas) in Vercel Environment Variables. Use a different `DATABASE_URL` for staging and production. Do not copy the local `localhost` database URL or `.env` to Vercel.
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

## Admin master API

All endpoints require a Bearer access token. The `:category` path accepts `amenities`, `bed-types`, `meal-types`, `room-view-types`, `floor`, `experience-categories`, `ota-channels`, `payment-methods`, or `cancellation-policy-types`.

| Method | Endpoint | Permission |
| --- | --- | --- |
| `GET` | `/api/v1/admin/master/:category` | `master.view` |
| `POST` | `/api/v1/admin/master/:category` | `master.create` |
| `PATCH` | `/api/v1/admin/master/:category/:id` | `master.edit` |
| `DELETE` | `/api/v1/admin/master/:category/:id` | `master.delete` |
| `GET` | `/api/v1/admin/master/capacity-patterns` | `master.view` |
| `POST` | `/api/v1/admin/master/capacity-patterns` | `master.create` |
| `PATCH` | `/api/v1/admin/master/capacity-patterns/:id` | `master.edit` |
| `DELETE` | `/api/v1/admin/master/capacity-patterns/:id` | `master.delete` |

Master item creation accepts `{ "name": "WiFi", "sortOrder": 0 }`; `code` is generated from the name and stays stable when the name changes. Capacity pattern creation accepts `{ "adults": 2, "children": 1, "sortOrder": 0 }`. PATCH accepts any subset of editable fields, including `isActive`. Deleting an item used by a room returns `409`; changing adult/child counts on an in-use capacity pattern also returns `409`. Deactivate it with PATCH instead. After applying the pending capacity pattern migration manually, rerun `npm run db:seed` to add the new role permissions and `npm run db:seed:master` to populate all master categories and capacity patterns. Neither command has been run for this API change.

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
| `npm run db:seed:master` | Seed room-related master items without a user password |
| `npm run format` | Format TypeScript and configuration with Prettier |
| `npm run format:check` | Check Prettier formatting |

## Database schema

Each table has its own file under `src/db/schema/`, named `<table_name>.schema.ts`. `columns.ts` holds shared column builders, and `index.ts` exports the 36 table definitions for Drizzle. `app-schema.ts` fixes the PostgreSQL application schema as `greenhero`. Staging and production use the same schema name in separate databases selected by `DATABASE_URL`, keeping one migration history valid in both environments. The schema follows the supplied PostgreSQL database design, including foreign keys, status checks, and partial unique indexes.

`drizzle.config.ts` reads `DATABASE_URL` from `.env`. Generated SQL and Drizzle snapshots live in `drizzle/`. Migration `0000_serious_warlock.sql` creates the original tables; `0001_far_sugar_man.sql` moves all 34 tables from `public` into `greenhero` without recreating them. Migration `0002_minor_romulus.sql` creates the separate `capacity_patterns` master table for adult/child counts and the `room_type_capacity_patterns` relation with room-specific extra bed counts, then removes `base_adults`, `base_children`, `max_adults`, and `max_children` from `room_types`. Migration `0003_old_professor_monster.sql` converts reservation, reservation payment, and deposit statuses to PostgreSQL enums and removes stored operational status. Only selected capacity combinations are linked to a room type. Drizzle keeps its migration journal separately in the `drizzle` schema. Review and apply migrations manually in each environment.

## Admin Room Types API

All endpoints require a bearer access token and the matching `rooms.*` permission:

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/room-types` | `rooms.view_types` | Paginated list with cover image; optional `search`, `isActive`, `page`, and `limit` |
| GET | `/api/v1/admin/room-types/:id` | `rooms.view_types` | Detail with amenities, capacity patterns, and images |
| POST | `/api/v1/admin/room-types` | `rooms.create_type` | Create type and its relations |
| PUT | `/api/v1/admin/room-types/:id` | `rooms.edit_type` | Replace editable type fields and relations |
| PATCH | `/api/v1/admin/room-types/:id/status` | `rooms.disable_type` | Set `{ "isActive": false }` or `true` |

POST and PUT require `code`, `slug`, `name`, `bedCount`, `extraBedEnabled`, `maxExtraBeds`, `extraBedPricePerNight`, `adultBreakfastPrice`, `childBreakfastPrice`, `basePricePerNight`, `amenityIds`, `capacityPatterns`, and `images`. Optional fields are `description`, `sizeSqm` (decimal string), `bedTypeId`, `mealTypeId`, and `viewTypeId`. A capacity entry has `{ "capacityPatternId": "uuid", "extraBeds": 0 }`; an image has `url` and optional `altText`, `isCover`, and `sortOrder`. Only one image may be the cover. Prices use integer rupiah. Master IDs must exist, be active, and match their respective categories. PUT replaces all amenity, capacity, and image relations with the submitted arrays.

## Admin Room Numbers API

Room numbers use the existing `room_units` table. A room number belongs to a room type and may reference a `floors` master item. `isActive` controls whether the physical room is active; `operationalStatus` is separately one of `available`, `occupied`, `cleaning`, `maintenance`, or `out_of_service`.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/room-numbers` | `rooms.view_numbers` | Paginated list; optional `search`, `roomTypeId`, `floorId`, `operationalStatus`, `isActive`, `page`, and `limit` |
| GET | `/api/v1/admin/room-numbers/:id` | `rooms.view_numbers` | Physical room detail with room type and floor names |
| POST | `/api/v1/admin/room-numbers` | `rooms.create_number` | Add a physical room |
| PUT | `/api/v1/admin/room-numbers/:id` | `rooms.edit_number` | Replace editable room fields |
| PATCH | `/api/v1/admin/room-numbers/:id/operational-status` | `rooms.change_operational_status` | Update `{ "operationalStatus": "maintenance" }` |
| DELETE | `/api/v1/admin/room-numbers/:id` | `rooms.edit_number` | Delete an unused physical room |

POST and PUT require `roomNumber`, `roomTypeId`, `operationalStatus`, and `isActive`; optional fields are `floorId` and `bedConfiguration`. The room number must be unique. Room type and floor references must be active and the floor must belong to the `floors` category. DELETE returns 409 if the room is referenced by a reservation or room change history; set `isActive` to false instead.

## Admin Prices & Stock API

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/prices-stocks` | `prices_stocks.view` | Daily rows for `roomTypeId`, `startDate`, and `endDate`; optional `page` and `limit` (max 30) |
| PUT | `/api/v1/admin/prices-stocks/bulk` | Per changed field | Create or update all matching dates in a range, up to 366 days, atomically |
| PUT | `/api/v1/admin/prices-stocks/bulk/rows` | Per changed field | Save different changes on up to 300 individual dates with version checks |

GET accepts up to 366 inclusive dates. Unconfigured dates have `basePrice`, `sellableStock`, `minNights`, `stopSell`, `id`, and `version` set to `null`, with `isConfigured: false`. These placeholders are not saved database rows. The response includes `items`, `page`, `limit`, `total`, `roomType`, and `stockLimit`.

Bulk range payload example:

```json
{
  "roomTypeId": "00000000-0000-0000-0000-000000000001",
  "startDate": "2026-10-01",
  "endDate": "2026-10-31",
  "fields": { "basePrice": 1500000, "sellableStock": 3 },
  "applicableWeekdays": [1, 2, 3, 4, 5, 6, 7],
  "customDayPrices": [
    { "weekday": 7, "basePrice": 1750000 }
  ]
}
```

The server expands the inclusive date range and writes matching dates in one transaction. `fields` may contain `basePrice`, `sellableStock`, `minNights`, or `stopSell`; omitted fields retain their existing value. `applicableWeekdays` defaults to all days, and `customDayPrices` overrides the general base price for selected ISO weekdays (1 = Monday, 7 = Sunday). Range updates intentionally overwrite selected fields and increment each existing row's version. If the range includes a date without a saved row, that date must receive both a price and stock explicitly; otherwise the whole request returns 400.

Use `/bulk/rows` for distinct per-date edits: provide `changes` with `stayDate`, `expectedVersion`, and at least one changed field. `expectedVersion` must be `null` for an unconfigured date or match the existing row's version. A new row must include both `basePrice` and `sellableStock`; existing rows may update only selected fields. A version conflict returns 409 and rolls back the entire batch. Both write endpoints check `prices_stocks.update_price`, `prices_stocks.update_stock`, `prices_stocks.manage_minimum_night`, and `prices_stocks.manage_stop_sell` according to fields changed. Stock cannot exceed the number of active Room Numbers. Campaign promotions are separate from inventory and are not stored or calculated by this endpoint.

## Admin Cancellation Policies API

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/cancellation-policies` | `cancellation_policies.view` | Paginated list; optional `search`, `source` (`website` or `phone`), `isActive`, `page`, and `limit` |
| GET | `/api/v1/admin/cancellation-policies/:id` | `cancellation_policies.view` | Policy with cancellation tiers and applicable Room Types |
| POST | `/api/v1/admin/cancellation-policies` | `cancellation_policies.create` | Create policy, tiers, and Room Type links |
| PUT | `/api/v1/admin/cancellation-policies/:id` | `cancellation_policies.edit` | Replace policy details, tiers, and Room Type links |
| PATCH | `/api/v1/admin/cancellation-policies/:id/status` | `cancellation_policies.disable` | Set `{ "isActive": false }` or `true` |

POST and PUT accept `name`, `appliesWebsite`, `appliesPhone`, `noShowChargeValue`, `isActive`, `roomTypeIds`, and `rules`. Optional fields are `policyTypeId` (from `cancellation_policy_types` Master), `stayStart`, `stayEnd`, and `noShowChargeType` (`percentage`, `first_night`, or `full_stay`). At least one booking source must be selected. An empty `roomTypeIds` array means all Room Types; null stay dates mean no stay-period restriction. Each rule has `timingType` (`more_than` or `within`), `daysBefore`, `chargeType` (`percentage`, `fixed`, or `nights`), `chargeValue`, and optional `sortOrder`. Percentages are capped at 100. `first_night` no-show value is 1; `full_stay` value is 100. Create and update save the policy and its relations in one transaction. Existing reservation policy snapshots are not changed by editing a policy.

## Admin Campaigns API

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/campaigns` | `campaigns.view` | Paginated list; optional `search`, `source`, `roomTypeId`, `isActive`, `page`, and `limit` |
| GET | `/api/v1/admin/campaigns/:id` | `campaigns.view` | Detail with sources, Room Types, applicable weekdays, and blackout dates |
| POST | `/api/v1/admin/campaigns` | `campaigns.create` | Create campaign and relations |
| PUT | `/api/v1/admin/campaigns/:id` | `campaigns.edit` | Replace campaign fields and relations; also requires `campaigns.set_priority` if priority changes |
| PATCH | `/api/v1/admin/campaigns/:id/priority` | `campaigns.set_priority` | Update `{ "priority": 1 }` |
| PATCH | `/api/v1/admin/campaigns/:id/status` | `campaigns.disable` | Set `{ "isActive": false }` or `true` |

POST and PUT require `name`, `requiresCode`, `discountType`, `discountValue`, `minNights`, `minRooms`, `priority`, `isActive`, `sources`, `roomTypeIds`, `weekdays`, and `blackoutDates`. Optional fields are `promoCode`, `bookingStart`, `bookingEnd`, `stayStart`, `stayEnd`, and `cancellationPolicyId`. Sources are `website`, `phone`, `walk_in`, and `ota`. Weekdays are ISO numbers 1 (Monday) through 7 (Sunday). An empty `roomTypeIds` array means all Room Types. Each blackout entry has `dateFrom`, `dateTo`, and optional `label`. A required promo code cannot be blank; discount percentages cannot exceed 100. The referenced Cancellation Policy must be active. Create and update save all relations in one transaction.

## Seed admin access

Run migrations first. Set a temporary `SEED_USER_PASSWORD` of at least 5 characters in your local `.env`, then run `npm run db:seed`. The seed creates the five roles and five users shown in the admin's static data, along with its permission matrix. It can be rerun: matching records are updated, while passwords for existing users are preserved. Every newly created user receives the provided password. The seeded `deni@greenhero.id` account is inactive, matching the admin data. Remove `SEED_USER_PASSWORD` from `.env` when it is no longer needed.

For room form choices, run `npm run db:seed:master` after migrations. It seeds all nine admin Master categories in `master_items`, plus ten adult/child combinations in the separate `capacity_patterns` table. Amenities and capacity patterns come from the admin room form; the other categories use the admin Master list. Extra bed counts belong to each room type relation and are not seeded as master values. The command is safe to rerun and does not change an item's active status. Run the updated seed manually after applying migration `0002`.

## Structure

```text
src/
  server.ts                 Fastify entry point, startup, and graceful shutdown
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
