# Private Connect department rooms

## Permission rules

Connect conversations have explicit `general`, `dm`, `department`, and `legacy_shared` types. Room type is never inferred from a null participant column.

- General stays company-wide for the current Hub Connect audience.
- DMs remain readable only by their two participants.
- Department rooms are bound to one of `graphics`, `development`, `communications`, `events`, or `marketing`.
- The database reads current active staff membership and assignment rows on every protected query. CEO/Admin oversight can read every department room. The ordinary staff/HOD branch requires an active membership and a matching department assignment.
- The app rollout gate in `eba_private.connect_is_active` remains CEO/Admin only. Staff/HOD do not gain dashboard, Connect, room, RPC, or media access from this migration. The matching-assignment branch is ready for a separately authorized employee/HOD rollout, but remains behind the existing gate.
- Message history/send, read receipts, counts, edit/delete, mentions, notifications, roster RPC, realtime reads, and private voice/photo/document Storage checks all call the same current room authorization logic. SSE room streams recheck RLS every 10 seconds and route away after access is revoked. Media remains in private buckets and has no public URLs.

## Existing room and history handling

The shipped Connect model maps room IDs `...0002` through `...0006` explicitly to Graphics, Development, Communications, Events and Marketing. The migration uses that known mapping, not message contents or null `member_low`.

- An empty mapped room is converted in place to that department's private room.
- A populated mapped room is marked `legacy_shared` and read-only. Its messages and room ID remain. The migration snapshots the active, profile-enrolled CEO/Admin readers who could see that shared history at cutover. Only those readers retain history access, and only while their management access remains active. New users do not inherit that historical access.
- It then creates a new private room for the department. No legacy content is moved or newly described as confidential.
- Any other unmapped shared room is archived read-only without a department label. It is not silently converted.
- General and DMs are retained. No messages, rooms, staff assignments, or activity are deleted or fabricated.

## Migration order

1. In the authorized development project, inspect `connect_private_rooms_preflight.sql`. It reports only room IDs, department mapping, message counts, and planned disposition; it does not print message bodies or member records.
2. Confirm existing prerequisites are present: Connect migrations `20261106000500` through `20261106000800`, department rooms `20261106001400`, assignments from `20261116115940_calendar_part1`, staff access `20261119130000`, and its forward repair `20261119160000`.
3. Review and apply the new forward migration `20261121100000_private_department_rooms.sql` in development only. It has a transaction guard that names missing prerequisites. Never rewrite an applied migration.
4. Run `connect_private_rooms_verification.sql`. It checks object/RLS/policy/function presence, department room shape, General, rollout gate, and explicitly reports bell-only department reminders. Dynamic room checks avoid querying a missing conversation table.

The standard deployed Connect server continues to use `SUPABASE_SECRET_KEY` only in server modules where already required; no new environment variable or dependency is introduced.

## Calendar reminder boundary

The current bell reminder jobs remain the only delivery. No calendar detail is posted to a department room. The reminder queue targets meeting participants; the department assignment list may contain people who are not meeting participants (and future employee/HOD rollout would add them as room readers). Until one transaction can prove that every current authorized room reader is entitled to each occurrence's details, group delivery stays `pending_private_groups`. Existing occurrence revision, cancellation, participant, and deduplication checks remain unchanged. No reminder was sent during implementation.

## Automated verification and remaining hosted acceptance

`npm run test:connect:private` uses room/member fixtures to exercise assignment match, outsider, CEO/Admin oversight, reassignment, deactivation, General/DM, and legacy-reader outcomes, then asserts the real migration and handlers wire every protected resource to those checks. This is offline fixture and SQL-contract coverage, not a live Postgres/RLS result.

After applying the migration in development, use separate disposable CEO, Admin, assigned staff, wrong-department HOD, and reassigned/deactivated test sessions. Verify direct Supabase REST requests (not just UI) for room discovery, history, sends, read receipts, member RPC, unread counts, message mutation, notifications and Storage download. Verify a nonparticipant receives no department event on `postgres_changes`; change assignment/status while an SSE stream is open and confirm the next refresh is denied and the page returns to Connect. Confirm General and participant-only DM flows remain intact.

Repeat Realtime and Storage tests under actual authenticated JWT roles because SQL contract tests cannot establish hosted publication configuration, policy evaluation, bucket settings, or Realtime authorization. No real accounts should be changed; use disposable development identities and synthetic messages only.
