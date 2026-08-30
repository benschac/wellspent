-- Drizzle custom migration: functions and triggers are not modeled by the
-- installed Drizzle version.
create function app.create_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app.profiles (id)
  values (new.id);

  return new;
end;
$$;

revoke execute
  on function app.create_profile_for_new_auth_user()
  from public, anon, authenticated;

create trigger create_profile_on_auth_user
  after insert on auth.users
  for each row
  execute function app.create_profile_for_new_auth_user();
