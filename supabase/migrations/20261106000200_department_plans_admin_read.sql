begin;

alter policy "Active CEOs can read submitted plans"
  on public.department_plans
  using (
    status = 'submitted'
    and lower((select auth.jwt()) ->> 'email') ~ '^[^@]+@enibrand[.]com$'
    and exists (
      select 1 from public.staff_memberships as member
      where member.user_id = (select auth.uid())
        and member.role in ('ceo', 'admin')
        and member.status = 'active'
    )
  );

alter policy "Active CEOs can read submitted plans"
  on public.department_plans rename to "Active CEOs and Admins can read submitted plans";

commit;
