-- Development only. Upload the files listed in README.md before inserting these rows.
insert into public.approval_requests
  (id, title, request_type, department, requester_name, message, external_url, start_date, end_date, attachment_names)
values
  ('eba00000-0000-4000-8000-000000000301', 'DEV — CEO review: launch artwork', 'graphics', 'Graphics', 'Development fixture',
   'Review the image and layout for the launch artwork.', null, null, null, array['launch-artwork.png']),
  ('eba00000-0000-4000-8000-000000000302', 'DEV — Admin review: website staging', 'website', 'Development', 'Development fixture',
   'Open the staging link and review the page structure.', 'https://example.com/', null, null, '{}'),
  ('eba00000-0000-4000-8000-000000000303', 'DEV — annual leave with document', 'leave', 'Events', 'Development fixture',
   'This is a synthetic leave request for testing private document access.', null, '2026-11-16', '2026-11-17', array['leave-support.txt']),
  ('eba00000-0000-4000-8000-000000000304', 'DEV — campaign brief', 'marketing', 'Marketing', 'Development fixture',
   'Review audience, channels, and launch messaging.', 'https://example.com/', null, null, '{}'),
  ('eba00000-0000-4000-8000-000000000305', 'DEV — sick notice', 'sick', 'Communications', 'Development fixture',
   'Synthetic notice for decision testing.', null, '2026-11-18', '2026-11-18', '{}'),
  ('eba00000-0000-4000-8000-000000000306', 'DEV — absence notice', 'absence', 'Events', 'Development fixture',
   'Synthetic absence notice for decision testing.', null, '2026-11-19', '2026-11-19', '{}')
on conflict (id) do nothing;
