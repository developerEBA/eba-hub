# Approved dashboard implementation — 25 October 2026

## Scope and structure

The overview at `/dashboard` now follows `public/reference/eba-dashboard-reference.png`, copied unchanged from the user-supplied image. It is implemented with actual Next.js/React components, links, checkboxes, tab filters, native dialogs, progress bars and CSS Grid. The reference image is not displayed as the dashboard. Only portrait artwork is reused through CSS sprite positions.

The overview has its own shell, selected in `AppShell` only for `/dashboard`. Existing module pages retain their previous shell and functionality. `workspace` and `notifications` were added to the module registry as honest coming-soon destinations; they are excluded from the existing legacy navigation so its order is preserved. No package, preset, backend, environment or deployment configuration changed.

### Source files

- `src/components/layout/dashboard-shell.tsx`: approved sidebar order, header search, notification/message links, profile disclosure, mobile navigation.
- `src/components/layout/app-shell.tsx`: select the overview shell without replacing other pages.
- `src/modules/dashboard/navigation.ts`: reference-specific navigation labels, icons, badges and route mapping.
- `src/modules/dashboard/components/dashboard.tsx`: server-composed banner, six statistics, all nine content cards and reusable card/attendee composition.
- `src/modules/dashboard/components/dashboard-interactions.tsx`: local task filters/completion, focus checkboxes and explicit sample-action dialogs.
- `src/modules/dashboard/components/reference-avatar.tsx`: reference portrait artwork rendered as responsive CSS sprites.
- `src/modules/dashboard/dashboard.css`: scoped layout, compact desktop breakpoints, mobile stacking and local asset styling. The desktop shell uses 100dvh, zero-minimum grid tracks and contained overflow; it never scales the entire page with transforms or zoom.
- `src/app/globals.css`: import the scoped dashboard stylesheet.
- `src/modules/workspace/config.ts`: register the two new coming-soon destinations.

### Assets and visual fidelity

- `public/reference/eba-dashboard-reference.png`: exact supplied design reference and portrait sprite source.
- `public/images/office.jpg`: local substitute office background from https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1600&q=85 . No runtime third-party photo request is needed.

Card arrangement, reference portrait artwork, navigation order, sample names/text, statistics and proportions are preserved. At 1536×1024, the first content row starts at 332px and the bottom row starts at 823px. No pixel-perfect claim is made: the original standalone office photo was not supplied, so the background is substituted; Lucide glyphs, browser emoji rendering and typography details also differ. Sample data is identified in the header; names, date, weather, metrics and achievements are not real employee records or live readings.

## Executed verification

All commands used bundled Node 24.19.0, with its bin directory first in PATH where npm scripts were used.

- `npm run typecheck`: passed.
- `npm run lint`: passed. An initial lint error from an accidentally repeated shell branch inside a map callback was corrected before final verification.
- `npm test`: all four existing permission/input-validation tests passed. The existing harmless MODULE_TYPELESS_PACKAGE_JSON warning remains.
- `npm run build`: passed, including framework TypeScript checking and page generation.
- Production smoke: all 16 dashboard sidebar destinations returned HTTP 200; the existing Admin route also returned 200.
- Browser task filters: Today renders 4 rows, This Week 8, Overdue 3. A checkbox updated the completion status. These local changes reset when leaving the overview.
- Browser action dialogs: Join Meeting, View Details and all eight quick actions opened explicit sample-state dialogs and closed successfully. No external operation was attempted.
- Production browser smoke repeated module search (projects yielded Projects) and Create Task dialog handling.
- Mobile 390×844: all nine sections remained present in the stacked layout, no horizontal overflow, drawer opened and closed. Mobile uses normal vertical page scrolling.

### Desktop screenshots and geometry

Production screenshots were captured through the browser screenshot API after Playwright-driven layout interaction, then visually inspected at the three explicitly requested sizes.

| Viewport  | Whole-page overflow | Nine sections inside viewport | Default card overflow |
| --------- | ------------------- | ----------------------------- | --------------------- |
| 1536×1024 | None                | Yes                           | None                  |
| 1440×900  | None                | Yes                           | None                  |
| 1366×768  | None                | Yes                           | None                  |
| 1920×1080 | None                | Yes                           | None                  |

Evidence: `docs/screenshots/dashboard-1536x1024.jpg`, `dashboard-1440x900.jpg`, `dashboard-1366x768.jpg`, `dashboard-1920x1080.jpg`, and machine-readable `docs/screenshots/viewport-checks.json`. Longer task tabs may scroll within their card; the desktop document remains fixed to the viewport.

The desktop compact breakpoint was adjusted after the 1440×900 check showed the browser's emulated CSS viewport did not match an exact max-height:900px boundary. Final geometry was remeasured against the production build after that correction.

## Limits

All records remain sample-only. No Supabase CRUD, real meetings, file uploads, messages, approvals, leave requests, notifications or report generation were enabled or tested. The original office photograph is still needed for an exact asset match. This is not a pixel-difference certification or a cross-browser/device certification. No new dependencies, live migrations, credentials or deployments were introduced.

The local verification server was stopped after testing. Run `npm run dev` using a supported Node version to preview the application.
