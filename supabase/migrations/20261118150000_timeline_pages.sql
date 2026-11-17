-- The full timeline (issue 15): the view also returns the month a memory is in, one line of the
-- conversation, and the comment count; a second view lists the months for the year tabs.
-- New columns go last so the view keeps its place for what already reads it.

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
  -- The month the memory is in, on the day it was sent in the chat's own time zone: 2023-07.
  to_char(m.at at time zone c.timezone, 'YYYY-MM') as month,
  -- One line of the conversation, as written: the first text message sent at or after the first
  -- photo, else the last one before it. Cut here only to keep the row small; the app cuts it
  -- cleanly for the screen. Null when the memory has no text message.
  left(
    coalesce(
      (
        select ms.text from public.messages ms
        where ms.memory_id = m.id and ms.media_kind is null and btrim(ms.text) <> ''
          and ms.at >= (select min(p.at) from public.photos p where p.memory_id = m.id)
        order by ms.at, ms.seq limit 1
      ),
      (
        select ms.text from public.messages ms
        where ms.memory_id = m.id and ms.media_kind is null and btrim(ms.text) <> ''
          and ms.at < (select min(p.at) from public.photos p where p.memory_id = m.id)
        order by ms.at desc, ms.seq desc limit 1
      )
    ),
    300
  ) as line,
  -- Comments arrive with issue 18; until then every memory has none.
  0::integer as comment_count
from public.memories m
join public.chats c on c.id = m.chat_id
where exists (select 1 from public.photos p where p.memory_id = m.id);

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
