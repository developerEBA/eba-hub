-- Additive migration. Never run against a live project without review.
alter type public.workspace_role add value if not exists 'management';
alter type public.workspace_role add value if not exists 'department_lead';
