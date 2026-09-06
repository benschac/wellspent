begin;
select plan(22);

select has_schema('app', 'the application schema exists');
select has_table('app', 'profiles', 'profiles table exists');
select has_table(
  'app',
  'google_calendar_connections',
  'Google Calendar connections table exists'
);
select has_table(
  'app',
  'google_calendar_oauth_states',
  'Google Calendar OAuth states table exists'
);
select has_table(
  'app',
  'google_calendar_subscriptions',
  'Google Calendar subscriptions table exists'
);
select has_table(
  'app',
  'google_calendar_event_links',
  'Google Calendar event links table exists'
);
select has_table(
  'app',
  'google_calendar_inbound_changes',
  'Google Calendar inbound changes table exists'
);
select has_table(
  'app',
  'google_calendar_jobs',
  'Google Calendar jobs table exists'
);

select col_is_pk('app', 'profiles', 'id', 'profile ID is the primary key');
select has_fk('app', 'profiles', 'profiles references its Supabase Auth user');
select has_fk(
  'app',
  'google_calendar_connections',
  'connections reference their Supabase Auth user'
);
select has_fk(
  'app',
  'google_calendar_oauth_states',
  'OAuth states reference their Supabase Auth user'
);

select ok(
  not has_schema_privilege('anon', 'app', 'usage')
    and not has_schema_privilege('authenticated', 'app', 'usage')
    and not has_schema_privilege('service_role', 'app', 'usage'),
  'Supabase Data API roles cannot use the application schema'
);
select is(
  (
    select count(*)::integer
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'app'
      and pg_class.relkind = 'r'
      and pg_class.relrowsecurity
  ),
  11,
  'all application tables keep default-deny RLS as defense in depth'
);

select has_function(
  'app',
  'create_profile_for_new_auth_user',
  array[]::text[],
  'the Auth profile creation function exists'
);
select has_trigger(
  'auth',
  'users',
  'create_profile_on_auth_user',
  'new Auth users trigger profile creation'
);
select ok(
  (
    select pg_proc.prosecdef
      and pg_proc.proconfig @> array['search_path=""']::text[]
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'app'
      and pg_proc.proname = 'create_profile_for_new_auth_user'
      and pg_get_function_identity_arguments(pg_proc.oid) = ''
  ),
  'the Auth trigger function uses owner privileges and an empty search path'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'app.create_profile_for_new_auth_user()',
    'execute'
  ),
  'authenticated users cannot execute the trigger function directly'
);

insert into auth.users (id)
values ('10000000-0000-4000-8000-000000000001');

select is(
  (
    select count(*)::integer
    from app.profiles
    where id = '10000000-0000-4000-8000-000000000001'
  ),
  1,
  'creating an Auth user creates exactly one application profile'
);

insert into app.profiles (id, display_name, time_zone)
values (
  '10000000-0000-4000-8000-000000000001',
  'Focus user',
  'America/New_York'
)
on conflict (id) do update
set display_name = excluded.display_name,
    time_zone = excluded.time_zone,
    updated_at = now();

select row_eq(
  $$
    select display_name, time_zone
    from app.profiles
    where id = '10000000-0000-4000-8000-000000000001'
  $$,
  row('Focus user'::text, 'America/New_York'::text),
  'the application server can update the provisioned profile'
);

delete from auth.users
where id = '10000000-0000-4000-8000-000000000001';

select is(
  (
    select count(*)::integer
    from app.profiles
    where id = '10000000-0000-4000-8000-000000000001'
  ),
  0,
  'deleting an Auth user cascades to its application profile'
);

set local role authenticated;
select throws_ok(
  $$select * from app.profiles$$,
  '42501',
  'permission denied for schema app',
  'authenticated Data API users cannot query profiles directly'
);
reset role;

select * from finish();
rollback;
