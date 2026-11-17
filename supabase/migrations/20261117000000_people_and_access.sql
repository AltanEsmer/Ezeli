-- People, and the one question every access rule asks: which person is this request?

create table public.people (
  id uuid primary key default gen_random_uuid(),
  -- Unique: the import matches its people file to people by display name.
  display_name text not null unique check (btrim(display_name) <> ''),
  is_owner boolean not null default false,
  -- The sign-in account of this person (one account per person). Linked by id,
  -- never by email, so the login id inside a personal link can change freely.
  user_id uuid unique references auth.users (id) on delete set null
);

-- Helpers live in a schema the API does not expose.
create schema private;
grant usage on schema private to authenticated;

-- The person behind this request, or null. Null when the account has no person,
-- and when the session no longer exists (signed out, or the link was replaced):
-- an access token stays valid for up to an hour after its session is gone, and
-- this check makes it useless at once.
create function private.current_person_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.id
  from public.people p
  join auth.sessions s on s.user_id = p.user_id
  where p.user_id = auth.uid()
    and s.id = (auth.jwt() ->> 'session_id')::uuid;
$$;
revoke all on function private.current_person_id() from public;
grant execute on function private.current_person_id() to authenticated;

-- Used by the app to learn who is signed in. Returns no row when nobody is.
create function public.current_person() returns table (id uuid, display_name text, is_owner boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.is_owner
  from public.people p
  where p.id = (select private.current_person_id());
$$;
revoke all on function public.current_person() from public, anon;
grant execute on function public.current_person() to authenticated;

alter table public.people enable row level security;

-- Nothing for visitors. Signed-in people read people, but never the account id.
revoke all on public.people from anon, authenticated;
grant select (id, display_name, is_owner) on public.people to authenticated;

create policy "people with a live session read people" on public.people
  for select to authenticated
  using ((select private.current_person_id()) is not null);
