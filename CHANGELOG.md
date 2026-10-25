# Foundation file manifest

All files below were created in the initially empty workspace.

| File                                                        | Purpose                                                                                                                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                              | App dependencies, private package metadata and dev/build/start/lint/typecheck commands.                                                                                                       |
| `package-lock.json`                                         | Reproducible npm dependency resolution.                                                                                                                                                       |
| `.gitignore`                                                | Excludes dependencies, build products, secrets and TypeScript caches.                                                                                                                         |
| `.env.example`                                              | Empty Supabase settings and explicit production preview switch.                                                                                                                               |
| `tsconfig.json`                                             | Strict TypeScript, App Router types and `@/` import alias.                                                                                                                                    |
| `next-env.d.ts`                                             | Next.js generated framework type declarations.                                                                                                                                                |
| `next.config.ts`                                            | Node.js server configuration and disabled framework response header.                                                                                                                          |
| `postcss.config.mjs`                                        | Tailwind v4 PostCSS integration.                                                                                                                                                              |
| `eslint.config.mjs`                                         | Next.js Core Web Vitals and TypeScript rules.                                                                                                                                                 |
| `components.json`                                           | shadcn/ui aliases and styling configuration.                                                                                                                                                  |
| `src/app/globals.css`                                       | Brand tokens including the appended light-theme EBA palette, DM Sans body text, Playfair headings, Yellowtail utility, responsive shell, dashboard artwork, focus and reduced-motion styling. |
| `src/app/layout.tsx`                                        | HTML document, global styles, EBA metadata and next/font/google configuration for DM Sans, Playfair Display and Yellowtail.                                                                   |
| `src/app/page.tsx`                                          | Redirects the entry route to the workspace overview.                                                                                                                                          |
| `src/app/not-found.tsx`                                     | Branded 404 with navigation back to the dashboard.                                                                                                                                            |
| `src/app/login/page.tsx`                                    | Honest sign-in setup placeholder; no account provisioning.                                                                                                                                    |
| `src/app/dashboard/layout.tsx`                              | Dynamic server-rendered session gate and application shell.                                                                                                                                   |
| `src/app/dashboard/page.tsx`                                | Thin route composing the dashboard module.                                                                                                                                                    |
| `src/app/dashboard/[module]/page.tsx`                       | Registry-backed placeholder pages for all six modules; unknown slugs return 404.                                                                                                              |
| `src/app/dashboard/loading.tsx`                             | Accessible skeleton loading state.                                                                                                                                                            |
| `src/app/dashboard/error.tsx`                               | Recoverable route error state.                                                                                                                                                                |
| `src/components/layout/app-shell.tsx`                       | Desktop sidebar collapse, mobile navigation, top bar, help and footer.                                                                                                                        |
| `src/components/shared/empty-state.tsx`                     | Reusable icon, heading and explanatory empty state.                                                                                                                                           |
| `src/components/ui/button.tsx`                              | Polymorphic Radix Slot/CVA button with variants and focus styles.                                                                                                                             |
| `src/components/ui/card.tsx`                                | Reusable semantic card container.                                                                                                                                                             |
| `src/components/ui/skeleton.tsx`                            | Reusable loading skeleton.                                                                                                                                                                    |
| `src/modules/dashboard/components/dashboard.tsx`            | Branded overview, module entry cards and explicit data-free empty states.                                                                                                                     |
| `src/modules/workspace/config.ts`                           | Single typed registry for module metadata and sidebar navigation.                                                                                                                             |
| `src/modules/auth/server.ts`                                | Server-only verified Supabase session gate and bounded setup preview.                                                                                                                         |
| `src/lib/utils.ts`                                          | Shared class-name composition.                                                                                                                                                                |
| `src/lib/supabase/config.ts`                                | Reads public Supabase environment configuration.                                                                                                                                              |
| `src/lib/supabase/client.ts`                                | Browser Supabase client factory.                                                                                                                                                              |
| `src/lib/supabase/server.ts`                                | Server-only cookie-aware Supabase client factory.                                                                                                                                             |
| `src/proxy.ts`                                              | Refreshes auth cookies and prevents caching session responses.                                                                                                                                |
| `supabase/migrations/202610250001_workspace_foundation.sql` | Empty employee-profile schema, role enum, RLS and self-read policy; no live migration applied.                                                                                                |
| `README.md`                                                 | Setup, module boundaries, authentication limits and deployment notes.                                                                                                                         |
| `CHANGELOG.md`                                              | This complete authored-file manifest.                                                                                                                                                         |

## Branding follow-up

- `src/app/layout.tsx`: configured DM Sans, Playfair Display and Yellowtail with `next/font/google`, body variables and requested metadata.
- `src/app/globals.css`: preserved existing styles and appended the exact EBA light-theme branding tokens and font utilities.
- `src/app/dashboard/[module]/page.tsx`: renamed the local module slug to satisfy Next.js lint without changing routing.
- `src/modules/workspace/components/demo-settings.tsx`: used `setAttribute` for the theme event handler to satisfy the React lint rule.
- `package.json` and `package-lock.json`: recorded the form, validation and chart dependencies imported by concurrently added modules.

Additional workspace changes made concurrently were preserved; they were not authored as part of this branding follow-up.

## 2026-10-25: Existing-project foundation completion

This pass audited an existing application; the original manifest above describes an earlier scaffold. No project was initialized and no user files or secrets were deleted.

Modified:

- `package.json`, `package-lock.json`: Zod, React Hook Form, compatible resolvers v5, Recharts; unit-test command.
- `tsconfig.json`: TypeScript-source imports for Node's native test runner.
- `.gitignore`, `.env.example`: environment protection and clear sample-mode documentation.
- `src/app/globals.css`: remove conflicting late brand overrides, preserve Tailwind/shadcn tokens, add dark theme and hidden mobile-nav focus protection.
- `src/components/ui/button.tsx`: themed card surface for outline buttons.
- `src/components/layout/app-shell.tsx`: scrollable complete navigation, sample banner and topbar tools.
- `src/modules/workspace/config.ts`: all requested primary and future destinations.
- `src/modules/dashboard/components/dashboard.tsx`: sample overview counts plus projects, tasks, meetings, announcements, messages and recognition.
- `src/app/dashboard/[module]/page.tsx`: real route composition for sample and coming-soon modules.
- `src/modules/auth/server.ts`: verified identity plus employee membership and reusable stored-role gate; preview cannot authorize operations.
- `src/proxy.ts`: retain Supabase SSR cache headers alongside refreshed cookies.
- `README.md`: corrected existing-project status, local setup, environment, architecture, migrations and roadmap.

Created:

- `AGENTS.md`: future engineering conventions.
- `src/components/layout/workspace-tools.tsx`: navigation search, notification and user disclosures.
- `src/modules/workspace/sample-data.ts`: explicitly fictional fixture records.
- `src/modules/workspace/schemas.ts`: bounded, typed task/message/recognition input validation.
- `src/modules/workspace/components/sample-list.tsx`: server-rendered sample lists.
- `src/modules/workspace/components/demo-settings.tsx`: validated local preferences and light/dark preview.
- `src/modules/workspace/components/delivery-chart.tsx`: sample Recharts analytics with accessible table.
- `src/modules/tasks/task-board.tsx`: ephemeral sample completion/filtering.
- `src/modules/auth/permissions.ts`: explicit role types and pure authorization predicates.
- `src/modules/integrations/contracts.ts`: future provider interfaces without fake adapters.
- `supabase/migrations/202610250002_roles.sql`: leadership role additions, separate transaction.
- `supabase/migrations/202610250003_workspace_modules.sql`: departments/memberships, projects/tasks, conversations/messages, meetings/attendees, notifications/recognition, indexes, helpers, grants and RLS.
- `tests/foundation.test.ts`: permission and input-validation tests.
- `docs/INTEGRATIONS.md`: secure integration boundaries, prerequisites and roadmap.
- `docs/VALIDATION.md`: actual checks, failures, corrections and external verification limits.

The existing font declarations were retained. `next.config.ts` retains its original deployment-neutral configuration. No Git repository exists, so no diff, commit or branch was created. Supabase schema and authorization behavior remain untested against a real database.

- docs/dashboard-preview.jpg: screenshot captured from the final production sample preview.

## 2026-10-25: Approved reference dashboard

Implemented the supplied reference as real components on `/dashboard`, with a dedicated scoped shell/CSS, complete reference navigation, banner, six statistics and all nine content cards. Existing module pages retain their shell. Added honest coming-soon destinations for My Workspace and Notifications, local task/focus interactions, and clear demo dialogs for unavailable actions. No package/preset/backend configuration changed.

Created `src/components/layout/dashboard-shell.tsx`, `src/modules/dashboard/navigation.ts`, `src/modules/dashboard/components/dashboard-interactions.tsx`, `src/modules/dashboard/components/reference-avatar.tsx`, `src/modules/dashboard/dashboard.css`, `public/reference/eba-dashboard-reference.png`, `public/images/office.jpg`, `docs/DASHBOARD-IMPLEMENTATION.md`, and production screenshot/geometry artifacts in `docs/screenshots/`.

Modified the overview composition, shell selection, global stylesheet import and module registry. Typecheck, lint, four tests, production build, all sidebar destination HTTP checks and four desktop viewport measurements passed. See `docs/DASHBOARD-IMPLEMENTATION.md` for exact checks, visual differences and demo limitations.

## 2026-10-25: Authenticated operation slices

Replaced the routed sample experience with real Supabase operations and explicit setup/empty/error states. No fake employee, count, ranking, message, meeting link or success response is substituted when services are unavailable. The approved dashboard grid remains in place.

Created:

- `src/modules/auth/actions.ts` and `src/app/auth/callback/route.ts`: Google OAuth PKCE and sign-out paths, approved active-employee gate.
- `src/modules/operations/`: typed read models, validators, RLS-backed Server Actions, operation forms/pages, persisted checkboxes, Realtime message refresh, private file verification/signed URLs, voice capture/playback, setup states and scoped styles.
- `src/app/api/search/route.ts`: authenticated RLS-scoped record search.
- Migrations `202610250004_authenticated_operations.sql`, `202610250005_files_meetings_reminders.sql`, `202610250006_supabase_storage_realtime.sql`: grants/RLS, transactional project/chat/leave/approval/nomination/meeting operations, active employee gate, delivery jobs, private Storage and Realtime publication.
- `tests/operations.test.ts`, `tests/postgres.test.ts`, `tests/supabase.integration.test.ts`: validation, disk-backed PostgreSQL policy/workflow tests and genuine opt-in Supabase integration suite.
- `.env.test.example`, `docs/FUNCTIONALITY.md`, and browser geometry evidence in `docs/screenshots/setup-checks.json`.

Modified:

- Dashboard composition and shell/header to load database records and show setup rather than sample figures.
- Dashboard layout/module route composition, login page, session gate/proxy matcher, workspace tools and module registry (leave route).
- Global stylesheet imports, environment example, ignore rules, README, package/lock (test-only PGlite dependency and Supabase test command).

Verification: TypeScript, ESLint, production build and 25 unit/PostgreSQL tests passed. One genuine Supabase integration test was skipped, not passed, because credentials/isolated-project authorization are absent. HTTP/browser setup and fail-closed checks passed. Live Auth/Storage/Realtime/Google and signed-in browser persistence remain unverified; several provider/business workflows remain unimplemented. See `docs/FUNCTIONALITY.md` for the required functionality checklist.

Updated AGENTS.md to prohibit routed prototype data and distinguish PostgreSQL tests from live Supabase verification. Added the unchanged-reminder regression test; the final local suite passed 25 tests with one live Supabase suite skipped.
