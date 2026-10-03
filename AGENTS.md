# Green Hero API: agent instructions

## Scope

- Work in this repository for API tasks. Do not change the admin or website project unless the user asks.
- Preserve existing endpoint paths, response shapes, permission checks, and reservation status rules when reorganizing code.
- Keep unrelated local changes. Do not commit or push unless the user explicitly requests it.
- Do not create or update Postman collections unless requested.

## Project structure

- This is a Node.js 24, TypeScript, Fastify, Drizzle, and PostgreSQL project.
- Register API routes in `src/routes/admin/` or `src/routes/public/`. Export each module's routes through its `src/modules/<module>/index.ts`.
- Within a module, put handlers in `routes/`, business and database logic in `services/`, and request schemas in `schemas/`. Keep small shared helpers at the module root when they do not fit those folders.
- Use one table per file in `src/db/schema/`; export tables from `src/db/schema/index.ts`. Follow the existing schema naming and formatting conventions.
- Use the existing Fastify authentication and permission guards for protected admin endpoints. Do not bypass RBAC in a handler.
- Keep reservation financial calculations, availability, campaign pricing, and status transitions in their existing shared services so route handlers do not duplicate those rules.

## Database and environments

- Database connections come from `DATABASE_URL`; do not hardcode local credentials or deploy secrets.
- Prepare schema and migration files when needed, but **do not run migrations or seeds**. The user applies them manually.
- Do not rewrite existing Drizzle migration snapshots merely to reformat or reorganize source files.
- Do not include `.env` values in logs, tool output, source files, or responses. Use `.env.example` for variable names and safe examples.

## Working and validation

- Inspect the affected module and its callers before changing exported paths or request contracts.
- Keep edits focused and format new TypeScript with Prettier conventions.
- For structural or TypeScript changes, run `npm run typecheck` and `git diff --check`. Run broader checks only when requested or needed for a specific failure.
- Report any API or UI capability that remains unsupported. State whether a migration is required; leave execution to the user.
