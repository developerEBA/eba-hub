# Recognition and activity statistics

## Recognition workflow

The active recognition scope contains exactly three monthly awards, with month boundaries in `Africa/Lagos`: Employee of the Month, Best Teamwork, and Most Improved Employee. Employee of the Month records contribution, beneficiaries, outcomes, dated evidence, and an HTTPS evidence link. Best Teamwork requires at least two eligible active contributors and documented collaboration and shared outcomes. Most Improved Employee requires a single eligible employee and dated before-and-after evidence, with both dates within the selected month and before preceding after. Message counts, sign-ins, and unsupported activity statistics are not evidence of improvement.

Active CEO and Admin accounts can nominate and independently review. Each review is private to its author until both roles submit; revisions remain available before publication. Both reviewers must agree on a nominee or No award. Only an active CEO can publish an agreed immutable result, including No award. Server actions and database RPCs enforce the same split. Advisory locks and unique period keys prevent duplicate publication; retry attempts return no new publication. Overview cards and Insights read the same three published monthly result records. An absent record is shown as “No published result”; an explicit `no_award` row is shown as “No award published.”

Employee of the Week, Employee of the Year, and yearly Best Teamwork are retired. Their old records are preserved and shown only in the read-only historical archive; weekly legacy RPCs and data remain unchanged. Existing yearly period rows are preserved in the shared recognition tables, but active Insights, Overview, and write RPCs exclude them.

The process is: **Admin and CEO nominate and review. CEO publishes the agreed result.** Overview cards read only published weekly and period result records. Draft nominations and private reviews are not shown there. Guided dashboard help is read-only and follows these permissions.

## Activity statistics limitation

The page shows the selected month in Africa/Lagos and explains that activity statistics are unavailable. Existing `department_plan_items` records use a free-text owner and do not retain verified contributor account IDs or completion timestamps. A submitted plan, approval, upload, edit, or deletion does not prove individual work was completed. Metrics need a future workflow with immutable task IDs, verified contributor IDs, auditable completion events containing actor and timestamp, and explicit rules for duplicate completion, reopening, edits, and deletion. No historical data is inferred and no activity count influences recognition.

## Migration and verification order

Run `supabase/checks/period_recognition_preflight.sql` first. Then apply only missing migrations in timestamp order; never rerun a migration recorded as applied:

1. `20261121130000_period_recognition.sql` (base month/year tables and RPCs), only if not already applied.
2. `20261121140000_period_recognition_ceo_nominations.sql` (forward correction for CEO/Admin period nominations), only if not already applied.
3. `20261121150000_recognition_ceo_publication.sql` (legacy weekly evidence metadata and CEO-only publication, including forward period publication correction), only if not already applied.
4. `20261122120000_monthly_recognition_scope.sql` (three-category monthly RPC scope and dated Most Improved evidence), only if not already applied.
5. `20261122130000_recognition_winner_profiles.sql` (winner profile RPC for published monthly results; already present in this shared checkout), only if not already applied.
6. Run rollback-only disposable database tests `supabase/tests/monthly_recognition_workflow.sql` and `supabase/tests/most_improved_evidence_constraint.sql` after all migrations, if local Supabase/PostgreSQL is configured. The earlier `period_recognition_ceo_nomination.sql` fixture predates the monthly-only category gate and is not part of the current verification run.
7. Run the combined read-only diagnostic `supabase/checks/period_recognition_verification.sql` after migration.

The Node recognition suite includes action mocks, period boundary tests, and static migration/diagnostic checks. Its actual PostgreSQL RPC and CHECK tests run only when `PERIOD_RECOGNITION_TEST_DATABASE_URL` points to loopback port 54322 and `psql` is available. A skipped local database test is not proof of SQL execution. After deployment, verify with distinct active CEO and Admin accounts: each can nominate only the three monthly categories; each sees only their own review until the second submits; disagreement blocks publication; Admin is denied even by direct RPC; CEO can publish the agreed nominee or No award; retired-category writes are rejected; and Most Improved rejects undated/out-of-period before-and-after evidence. Also verify active status and nominee eligibility against hosted data. Catalog checks and local fixtures do not prove hosted RLS/session behavior.
