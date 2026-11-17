-- The language a person chose in the menu, kept on the person so it follows them to another device.
-- Null until they choose: the app then follows the browser.

alter table public.people add column language text check (language in ('tr', 'en'));

-- current_person also tells the app the language. A new column in the result means a new function.
drop function public.current_person();
create function public.current_person() returns table (id uuid, display_name text, is_owner boolean, language text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.display_name, p.is_owner, p.language
  from public.people p
  where p.id = (select private.current_person_id());
$$;
revoke all on function public.current_person() from public, anon;
grant execute on function public.current_person() to authenticated;

-- The only thing the app writes about a person: the caller's own language, and nothing else.
-- `people` itself stays read-only for everyone (no update right, no update policy).
-- It fails loudly instead of changing nothing: with no valid session (signed out, or the link was
-- replaced) the app must not believe it saved. A wrong value gets a plain message of its own, never
-- the database's own error, which would repeat the person's row. Null is not offered.
create function public.set_my_language(chosen text) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  me uuid := (select private.current_person_id());
begin
  if me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if chosen is null or chosen not in ('tr', 'en') then
    raise exception 'unknown language' using errcode = '22023';
  end if;
  update public.people set language = chosen where id = me;
end;
$$;
revoke all on function public.set_my_language(text) from public, anon;
grant execute on function public.set_my_language(text) to authenticated;
