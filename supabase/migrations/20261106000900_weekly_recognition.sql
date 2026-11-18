begin;

create table public.weekly_recognition (
  week_start date primary key check (extract(isodow from week_start) = 1),
  winner_id uuid references auth.users(id) on delete set null,
  winner_name text not null,
  reason text not null check (length(btrim(reason)) between 1 and 240 and length(reason) <= 240),
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz not null default now()
);

alter table public.weekly_recognition enable row level security;
revoke all on public.weekly_recognition from public, anon, authenticated;
grant select on public.weekly_recognition to authenticated;
create policy "Active executives read weekly recognition"
  on public.weekly_recognition for select to authenticated
  using ((select eba_private.hub_is_active()));

create function eba_private.recognition_admin()
returns boolean language sql stable security invoker set search_path = ''
as $$
  select eba_private.hub_is_active() and exists (
    select 1 from public.staff_memberships
    where user_id = auth.uid() and role = 'admin' and status = 'active'
  );
$$;

create function eba_private.weekly_recognition_candidates()
returns table (user_id uuid, display_name text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, left(coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), ''), split_part(u.email, '@', 1)), 120)
  from public.staff_memberships m
  join auth.users u on u.id = m.user_id
  where eba_private.recognition_admin()
    and m.role = 'staff' and m.status = 'active' and lower(u.email) ~ '^[^@]+@enibrand[.]com$'
  order by 2, 1;
$$;

create function public.weekly_recognition_candidates()
returns table (user_id uuid, display_name text)
language sql stable security invoker set search_path = ''
as $$ select * from eba_private.weekly_recognition_candidates(); $$;

create function eba_private.publish_weekly_recognition(p_week_start date, p_winner_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  clean_reason text := btrim(p_reason, E' \t\r\n');
begin
  if not eba_private.recognition_admin() then
    raise insufficient_privilege using message = 'Only an active Admin can publish recognition';
  end if;

  if p_week_start is null or extract(isodow from p_week_start) <> 1
     or p_week_start > (now() at time zone 'Africa/Lagos')::date
     or clean_reason is null or length(clean_reason) not between 1 and 240 then
    return false;
  end if;

  insert into public.weekly_recognition (week_start, winner_id, winner_name, reason, published_by)
  select p_week_start, candidate.user_id, candidate.display_name, clean_reason, auth.uid()
  from eba_private.weekly_recognition_candidates() candidate
  where candidate.user_id = p_winner_id
  on conflict (week_start) do nothing;

  return found;
end;
$$;

create function public.publish_weekly_recognition(p_week_start date, p_winner_id uuid, p_reason text)
returns boolean language sql security invoker set search_path = ''
as $$ select eba_private.publish_weekly_recognition(p_week_start, p_winner_id, p_reason); $$;

revoke all on function eba_private.recognition_admin(), eba_private.weekly_recognition_candidates(),
  public.weekly_recognition_candidates(), eba_private.publish_weekly_recognition(date, uuid, text),
  public.publish_weekly_recognition(date, uuid, text) from public, anon, authenticated;
grant execute on function eba_private.weekly_recognition_candidates(), public.weekly_recognition_candidates(),
  eba_private.publish_weekly_recognition(date, uuid, text), public.publish_weekly_recognition(date, uuid, text)
  to authenticated;

commit;
