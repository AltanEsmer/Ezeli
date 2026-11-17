-- One memory in one request, for the memory screen (issue 16).

-- The timeline needs the memory's lasting key to link to it. A view may only gain columns at the
-- end, so this is the one added.
create or replace view public.timeline with (security_invoker = true) as
select
  m.id,
  m.at,
  c.name as chat_name,
  c.timezone,
  (select count(*) from public.photos p where p.memory_id = m.id)::integer as photo_count,
  (
    select coalesce(
      jsonb_agg(
        jsonb_build_object('thumb', f.thumb_path, 'width', f.width, 'height', f.height, 'by', f.display_name)
        order by f.at, f.seq
      ),
      '[]'::jsonb
    )
    from (
      select p.thumb_path, p.width, p.height, p.at, p.seq, pe.display_name
      from public.photos p
      join public.people pe on pe.id = p.person_id
      where p.memory_id = m.id
      order by p.at, p.seq
      limit 3
    ) f
  ) as photos,
  (
    select coalesce(array_agg(s.display_name order by s.first_at, s.display_name), '{}')
    from (
      select pe.display_name, min(p.at) as first_at
      from public.photos p
      join public.people pe on pe.id = p.person_id
      where p.memory_id = m.id
      group by pe.display_name
    ) s
  ) as senders,
  m.key
from public.memories m
join public.chats c on c.id = m.chat_id
where exists (select 1 from public.photos p where p.memory_id = m.id);

-- A person's lasting id (the slug of the people file) may be read: the people screen links names by
-- it. It is a short word the owners chose, never a secret.
grant select (slug) on public.people to authenticated;

-- A memory by its lasting key: the chat it came from, all photos, all messages with who wrote them
-- and when (`by_id` is the sender's lasting person id, null when the owners gave none), and the keys of the memory before and after it in time (the timeline's order: the moment, then the key; so only
-- memories with a stored photo). A memory that does not exist, one without a stored photo and one
-- the reader may not see all give null: nothing tells them apart. Runs with the reader's rights.
create function public.memory_detail(p_key text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'at', m.at,
    'chat_name', c.name,
    'timezone', c.timezone,
    'photos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'message', p.message_id, 'view', p.view_path, 'thumb', p.thumb_path,
        'width', p.width, 'height', p.height, 'by', pe.display_name, 'by_id', pe.slug
      ) order by p.at, p.seq), '[]'::jsonb)
      from public.photos p join public.people pe on pe.id = p.person_id
      where p.memory_id = m.id
    ),
    'messages', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'by', pe.display_name, 'by_id', pe.slug, 'at', g.at, 'text', g.text, 'kind', g.media_kind
      ) order by g.at, g.seq), '[]'::jsonb)
      from public.messages g join public.people pe on pe.id = g.person_id
      where g.memory_id = m.id
    ),
    'before', (
      select o.key from public.memories o
      where (o.at, o.key) < (m.at, m.key) and exists (select 1 from public.photos p where p.memory_id = o.id)
      order by o.at desc, o.key desc limit 1
    ),
    'after', (
      select o.key from public.memories o
      where (o.at, o.key) > (m.at, m.key) and exists (select 1 from public.photos p where p.memory_id = o.id)
      order by o.at asc, o.key asc limit 1
    )
  )
  from public.memories m
  join public.chats c on c.id = m.chat_id
  where m.key = p_key
    and exists (select 1 from public.photos p where p.memory_id = m.id)
$$;

revoke all on function public.memory_detail(text) from public, anon, authenticated;
grant execute on function public.memory_detail(text) to authenticated;
