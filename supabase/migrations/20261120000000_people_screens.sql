-- The people screens (issue 17).
--
-- A person is addressed by their lasting id (`people.slug`). Everything here runs with the reader's
-- rights, so the access rules of the tables apply: a visitor has no right to call these, and a
-- person whose session has ended reads nothing (an empty list, or null). Only the display name,
-- the lasting id and the photos a person sent are returned; never the account behind them.
-- A person "took part" in a memory when they sent a photo or a message in it.

-- The memories a person took part in are one set, looked up from the person's own rows (the two
-- indexes make it a lookup, not a pass over every memory), and used the same way everywhere.
create index messages_person on public.messages (person_id, memory_id);
create index photos_person on public.photos (person_id, memory_id);

-- The timeline's pages, optionally only the memories one person took part in. The old signature is
-- replaced, not overloaded, so a call always means one function. A person who is not there (or may
-- not be seen) has no memories.
drop function public.timeline_page(boolean, timestamp, text, integer, boolean);
create function public.timeline_page(p_newer boolean, p_at timestamp, p_key text, p_limit integer, p_inclusive boolean default false, p_person text default null)
returns setof public.timeline
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_person uuid := (select pe.id from public.people pe where pe.slug = p_person);
begin
  if p_person is not null and v_person is null then
    return;
  end if;
  if p_newer then
    return query
      select t.* from public.timeline t
      where (p_at is null
         or (t.local_at, t.key) > (p_at, p_key)
         or (p_inclusive and (t.local_at, t.key) = (p_at, p_key)))
        and (v_person is null or t.id in (
          select g.memory_id from public.messages g where g.person_id = v_person
          union select p.memory_id from public.photos p where p.person_id = v_person))
      order by t.local_at, t.key
      limit least(greatest(p_limit, 1), 100);
  else
    return query
      select t.* from public.timeline t
      where (p_at is null
         or (t.local_at, t.key) < (p_at, p_key)
         or (p_inclusive and (t.local_at, t.key) = (p_at, p_key)))
        and (v_person is null or t.id in (
          select g.memory_id from public.messages g where g.person_id = v_person
          union select p.memory_id from public.photos p where p.person_id = v_person))
      order by t.local_at desc, t.key desc
      limit least(greatest(p_limit, 1), 100);
  end if;
end;
$$;
revoke all on function public.timeline_page(boolean, timestamp, text, integer, boolean, text) from public, anon, authenticated;
grant execute on function public.timeline_page(boolean, timestamp, text, integer, boolean, text) to authenticated;

-- The year tabs of one person's timeline: the months of their memories, newest first.
create function public.person_months(p_person text) returns table (month text, memories integer)
language sql stable security invoker set search_path = '' as $$
  select to_char(m.at at time zone c.timezone, 'YYYY-MM'), count(*)::integer
  from public.memories m
  join public.chats c on c.id = m.chat_id
  where exists (select 1 from public.photos p where p.memory_id = m.id)
    and m.id in (
      select g.memory_id from public.messages g where g.person_id = (select pe.id from public.people pe where pe.slug = p_person)
      union select p.memory_id from public.photos p where p.person_id = (select pe.id from public.people pe where pe.slug = p_person))
  group by 1
  order by 1 desc
$$;
revoke all on function public.person_months(text) from public, anon, authenticated;
grant execute on function public.person_months(text) to authenticated;

-- One person's page: name, how many photos they sent, and the first and latest memory they took
-- part in (the moment and the chat's time zone, which the date is shown in). Null when there is
-- no such person, or the reader may not see them.
create function public.person_page(p_person text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  with me as (select pe.id, pe.slug, pe.display_name from public.people pe where pe.slug = p_person),
  mine as (
    select m.at, c.timezone, m.key, (m.at at time zone c.timezone) as local_at
    from public.memories m join public.chats c on c.id = m.chat_id
    where exists (select 1 from public.photos p where p.memory_id = m.id)
      and m.id in (
        select g.memory_id from public.messages g where g.person_id = (select id from me)
        union select p.memory_id from public.photos p where p.person_id = (select id from me))
  )
  select jsonb_build_object(
    'id', me.slug,
    'name', me.display_name,
    'photo_count', (select count(*) from public.photos p where p.person_id = me.id),
    'first', (select jsonb_build_object('at', x.at, 'timezone', x.timezone) from mine x order by x.local_at, x.key limit 1),
    'last', (select jsonb_build_object('at', x.at, 'timezone', x.timezone) from mine x order by x.local_at desc, x.key desc limit 1)
  )
  from me
$$;
revoke all on function public.person_page(text) from public, anon, authenticated;
grant execute on function public.person_page(text) to authenticated;

-- The people page: everyone with a lasting id, by name, each with up to four of the photos they
-- sent most recently (small size).
create function public.people_page() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', pe.slug,
    'name', pe.display_name,
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object('thumb', f.thumb_path, 'width', f.width, 'height', f.height) order by f.at desc, f.seq desc), '[]'::jsonb)
      from (select p.thumb_path, p.width, p.height, p.at, p.seq from public.photos p where p.person_id = pe.id order by p.at desc, p.seq desc limit 4) f
    )
  ) order by pe.display_name, pe.slug), '[]'::jsonb)
  from public.people pe
  where pe.slug is not null
$$;
revoke all on function public.people_page() from public, anon, authenticated;
grant execute on function public.people_page() to authenticated;
