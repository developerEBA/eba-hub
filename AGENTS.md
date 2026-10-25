# EBA Hub engineering conventions

Use the existing Next.js App Router, TypeScript strict mode, Tailwind v4, shadcn/Radix and Supabase modular monolith. Preserve existing setup and user files. Do not create another app.

- Routes compose modules. Feature rules, schemas and repositories belong to their owning module. Shared components must not query a database.
- Default to Server Components. Use client components only for state, forms, charts and browser events. Do not pass icon functions across server/client boundaries.
- Use the branded CSS variables, DM Sans for UI, Playfair for selected headings, Yellowtail for occasional accents. Verify light/dark, keyboard access and mobile layout.
- Label all fictional records SAMPLE DATA. Demo interactions must say whether changes persist. Preview cannot authorize production operations.
- Every server action, route handler and privileged query must verify identity, employee membership and stored permissions. Layout checks alone are insufficient. Keep RLS enabled. Never accept a client role as authority.
- Keep privileged credentials server-only. Never log secrets, commit env files, apply migrations, send mail, create accounts or deploy without the applicable authorization.
- Migrations are additive and versioned. Do not edit a migration that has been applied. Test RLS with distinct employees, outsiders and roles before live data.
- Use Zod for untrusted inputs and React Hook Form for interactive forms. Avoid dependencies without a specific need.
- Run typecheck, lint, tests and production build after meaningful changes. Report unexecuted checks honestly. Node >=22 is required.
- Keep integration adapters behind src/modules/integrations/contracts.ts; do not invent successful provider responses.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Functional application rules

- Routed dashboard and module pages must use authenticated Supabase operations. Historical sample fixtures/components are source references only; do not reintroduce them as live data or local-only persistence.
- Active employee membership and RLS are mandatory. Public setup mode never authorizes a write. Do not return success before a database/provider operation succeeds.
- PGlite is test infrastructure only. Supabase remains the sole application database. Report local SQL tests separately from real Auth/REST/Realtime/Storage verification; skipped integration tests are not passes.
