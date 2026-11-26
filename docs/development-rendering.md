# Idle reload / interrupted Suspense rendering

The reported logs showed Calendar and Overview repeatedly loading while idle,
with near-zero-duration recompiles and React's interrupted Suspense warning.
Both pages use the shared dashboard shell, so the investigation covered shared
development file watching and notification refreshes as well as Calendar.

Two reload triggers were corrected:

- Tailwind's automatic source detection scanned the project root, including
  generated browser snapshots, documentation and SQL/test artifacts.
  Its Turbopack loader registered broad context dependencies. `globals.css` now
  uses `source("../")`, relative to `src/app`, to scan only `src`. The actual
  installed scanner now reports zero input files or watched globs outside `src`.
  Generated logs, snapshots, dependency installs and build output are not UI
  class sources. Framework/compiler imports retain their normal dependencies.
- The shared notification listener treated each subscription's initial `ready`
  handshake as a reason to call `router.refresh()`. If a page boundary remounted,
  that mounted another listener and refreshed again. It now ignores the initial
  handshake, debounces actual `changed` events, and catches up on later reconnect
  handshakes. Cleanup still closes the stream and cancels pending refreshes.

No Suspense boundary, authentication check, notification event delivery, Calendar
permission, Google credential flow or framework cache feature was disabled.
No dependency install or database migration is required for this correction.

Verification:

```powershell
npm run test:rendering
npm run test:calendar
npm run lint
npx tsc --noEmit
npm run build
```

The rendering regression tests exercise the installed Tailwind compiler/scanner
and the real notification effect with controlled browser APIs and a fake clock.
They verify source isolation, no initial refresh, one refresh for a notification
burst without a remount loop, reconnect catch-up and timer cleanup.

An isolated browser check also rendered the actual React notification component:
initial handshake caused zero refreshes; 25 changes caused one refresh; idle time
caused no further refresh; reconnect caused one catch-up; unmount cancelled a
pending refresh. Browser console errors: zero. A local signed-out smoke check
preserved the sign-in gate and did not reload when a generated diagnostic
snapshot changed. The available browser session was signed out, so this is not
reported as an authenticated Calendar/Overview end-to-end pass.

After updating, reload the signed-in page once and leave Calendar/Overview idle.
There should be no rapid repeated page GETs, recompiles or Suspense interruption
warnings. Real notification changes and a genuine stream reconnect may refresh
once. If an already running development server retains the old broad watch graph,
restart `npm run dev` once and reload. Do not repeatedly clear the build directory
or disable server rendering to conceal the warning.

Reference: [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files).
