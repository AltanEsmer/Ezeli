-- The full timeline (issue 15).
--
-- One order everywhere: the date as shown, which is the chat's clock time (`local_at`), with the
-- memory's lasting key breaking ties. The timeline, its pages, its months and the memory screen's
-- earlier and later all use it, so a month never repeats and memories from the same moment never
-- skip or double.

-- The view keeps its columns (a view may only gain columns at the end) and gains: the month, one
-- line of the conversation, the comment count, and the clock time the order is made of.
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
  m.key,
  -- The month the memory is in, on the day it was sent in the chat's own time zone: 2023-07.
  to_char(m.at at time zone c.timezone, 'YYYY-MM') as month,
  -- One line of the conversation, as written: the first text at or after the first photo, else the
  -- last one before it. A photo's caption is text like any other. Cut here only to keep the row
  -- small; the app cuts it cleanly for the screen. Null when the memory has no text.
  left(
    coalesce(
      (
        select ms.text from public.messages ms
        where ms.memory_id = m.id and btrim(ms.text) <> ''
          and (ms.media_kind is null or ms.media_kind = 'photo')
          and ms.at >= (select min(p.at) from public.photos p where p.memory_id = m.id)
        order by ms.at, ms.seq limit 1
      ),
      (
        select ms.text from public.messages ms
        where ms.memory_id = m.id and btrim(ms.text) <> ''
          and (ms.media_kind is null or ms.media_kind = 'photo')
          and ms.at < (select min(p.at) from public.photos p where p.memory_id = m.id)
        order by ms.at desc, ms.seq desc limit 1
      )
    ),
    300
  ) as line,
  -- Comments arrive with issue 18; until then every memory has none.
  0::integer as comment_count,
  -- The date as shown: the clock time in the chat's time zone. No zone, so it is the same
  -- wherever the reader is.
  (m.at at time zone c.timezone) as local_at
from public.memories m
join public.chats c on c.id = m.chat_id
where exists (select 1 from public.photos p where p.memory_id = m.id);

-- One page of the timeline, in one request. Newest first (`p_newer` false): the memories after the
-- cursor `(p_at, p_key)`, going back in time. `p_newer` true: the memories before it, going
-- forward, nearest first. With no cursor, the newest. `p_inclusive` also returns the memory at
-- the cursor. A page is at most 100.
create function public.timeline_page(p_newer boolean, p_at timestamp, p_key text, p_limit integer, p_inclusive boolean default false)
returns setof public.timeline
language plpgsql stable security invoker set search_path = ''
as $$
begin
  if p_newer then
    return query
      select t.* from public.timeline t
      where p_at is null
         or (t.local_at, t.key) > (p_at, p_key)
         or (p_inclusive and (t.local_at, t.key) = (p_at, p_key))
      order by t.local_at, t.key
      limit least(greatest(p_limit, 1), 100);
  else
    return query
      select t.* from public.timeline t
      where p_at is null
         or (t.local_at, t.key) < (p_at, p_key)
         or (p_inclusive and (t.local_at, t.key) = (p_at, p_key))
      order by t.local_at desc, t.key desc
      limit least(greatest(p_limit, 1), 100);
  end if;
end;
$$;
revoke all on function public.timeline_page(boolean, timestamp, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.timeline_page(boolean, timestamp, text, integer, boolean) to authenticated;

-- Which months have memories, for the year tabs: newest first, with how many.
create view public.timeline_months with (security_invoker = true) as
select to_char(m.at at time zone c.timezone, 'YYYY-MM') as month, count(*)::integer as memories
from public.memories m
join public.chats c on c.id = m.chat_id
where exists (select 1 from public.photos p where p.memory_id = m.id)
group by 1
order by 1 desc;

revoke all on public.timeline_months from anon, authenticated;
grant select on public.timeline_months to authenticated;

-- The memory screen's earlier and later follow the same order as the timeline.
create or replace function public.memory_detail(p_key text) returns jsonb
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
      select o.key from public.memories o join public.chats oc on oc.id = o.chat_id
      where ((o.at at time zone oc.timezone), o.key) < ((m.at at time zone c.timezone), m.key)
        and exists (select 1 from public.photos p where p.memory_id = o.id)
      order by (o.at at time zone oc.timezone) desc, o.key desc limit 1
    ),
    'after', (
      select o.key from public.memories o join public.chats oc on oc.id = o.chat_id
      where ((o.at at time zone oc.timezone), o.key) > ((m.at at time zone c.timezone), m.key)
        and exists (select 1 from public.photos p where p.memory_id = o.id)
      order by (o.at at time zone oc.timezone), o.key limit 1
    )
  )
  from public.memories m
  join public.chats c on c.id = m.chat_id
  where m.key = p_key
    and exists (select 1 from public.photos p where p.memory_id = m.id)
$$;
