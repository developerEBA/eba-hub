# Validation record — 25 October 2026

## Audit

Existing: Next.js 16.4.3, React 19.3.1, TypeScript strict mode, Tailwind v4, shadcn-style local primitives with Radix Slot/Lucide, fonts through next/font/google, separate Supabase clients and proxy, responsive shell, loading/error/not-found states. components.json uses `new-york`, not a recorded Nova preset; it was preserved rather than replacing the working component setup.

Corrections: expanded six placeholder modules; consolidated contradictory CSS branding declarations; completed theme tokens; added sample presentation and interactive boundaries; required employee profile membership after claim verification; prepared the missing domain schema and stored-role foundation. No environment credentials were present (only .env.example). No hardcoded credentials were found in source by targeted inspection. No claim of exhaustive security certification is made.

The terminal default is Node 20.20.0, below the project's Node >=22 requirement. Checks used bundled Node 24.19.0 by placing its bin directory first in PATH for npm scripts. Use a supported Node locally. Git status failed because this directory is not a repository.

## Executed checks

- Dependency installation succeeded: 45 packages added; npm reported zero vulnerabilities. Latest @hookform/resolvers v6 initially failed peer resolution; compatible v5 installed without forcing peer dependencies.
- `npm run lint`: passed.
- `npm run typecheck`: passed after correcting a test fixture's literal role typing.
- `npm test`: four tests passed (unknown roles, permission boundaries, task identifiers/title validation, bounded message/recognition input). Tests use Node's in-process isolation mode because sandbox child spawning initially returned EPERM. A harmless module-type inference warning remains.
- `npm run build`: passed under Node 24 with compiler worker permissions. An initial sandbox build failed at worker spawn with EPERM; an immediate retry encountered a temporary build lock, which cleared before the successful retry. Final recheck status is recorded below.
- Production HTTP smoke with `EBA_SETUP_PREVIEW=true`: dashboard, all 14 module destinations and login returned 200. Every workspace page included the sample-data banner. Unknown module rendered the not-found content; Next's streamed notFound response can retain HTTP 200 after streaming begins.
- Production default (`EBA_SETUP_PREVIEW=false`, no credentials): `/dashboard` returned 307 with Location `/login`.
- Browser: dashboard rendered at 1440×1000; task view at 390×844 remained readable; a sample checkbox updated count to 1/3 and Complete filtering showed only that task; mobile navigation opened and selected Settings; applying Dark changed the rendered theme and confirmed local-only status. Sidebar collapse, search, notification and user disclosures were inspected in source; additional browser checks are recorded below if performed.

## Limits

No Supabase project, CLI database application, SQL execution, RLS integration test, real authentication flow, Realtime, Storage upload, Google integration, scheduled worker, paid API, or deployment was performed. SQL policy correctness must be tested with multiple identities in an isolated database before production use. Only sample UI interactions have been verified; these do not demonstrate provider functionality.

The first browser attempt used port 3000 before the preview server was running and timed out. Verification subsequently used the owned production preview on port 3100. Preview processes are stopped after verification; use npm run dev to reopen locally.

Final recheck: lint, TypeScript, all four tests and production build passed after the proxy cache-header and mobile focus fixes. No standalone-output startup warning remains in the final configuration.

Final browser checks: sidebar collapsed and expanded; searching calendar reduced navigation results to Smart Calendar. Final dashboard screenshot saved as docs/dashboard-preview.jpg. A stale tab showed connection-refused content after the server restart; a fresh tab loaded the final build successfully.

