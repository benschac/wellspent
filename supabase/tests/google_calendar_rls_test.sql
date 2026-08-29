begin;
select plan(12);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.google_calendar_connections'::regclass),
  'connections has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.google_calendar_connections', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.google_calendar_connections', 'select,insert,update,delete'),
  'client roles cannot access connections directly'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.google_calendar_oauth_states'::regclass),
  'OAuth states has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.google_calendar_oauth_states', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.google_calendar_oauth_states', 'select,insert,update,delete'),
  'client roles cannot access OAuth states directly'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.google_calendar_subscriptions'::regclass),
  'subscriptions has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.google_calendar_subscriptions', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.google_calendar_subscriptions', 'select,insert,update,delete'),
  'client roles cannot access subscriptions directly'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.google_calendar_event_links'::regclass),
  'event links has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.google_calendar_event_links', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.google_calendar_event_links', 'select,insert,update,delete'),
  'client roles cannot access event links directly'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.google_calendar_jobs'::regclass),
  'jobs has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.google_calendar_jobs', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.google_calendar_jobs', 'select,insert,update,delete'),
  'client roles cannot access jobs directly'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.google_calendar_inbound_changes'::regclass),
  'inbound changes has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.google_calendar_inbound_changes', 'select,insert,update,delete')
    and not has_table_privilege('authenticated', 'public.google_calendar_inbound_changes', 'select,insert,update,delete'),
  'client roles cannot access inbound changes directly'
);

select * from finish();
rollback;
