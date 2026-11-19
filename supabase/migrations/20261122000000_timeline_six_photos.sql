-- The timeline carries up to six photos per memory (it carried three).
--
-- A phone draws up to four photos in a block and a PC draws a row of as many as fit, so three was
-- too few for both. Only the view changes, with no change to a table. `timeline_page` (with or
-- without a person) and `search_memories` return `setof public.timeline`, so all three lists carry
-- six with this one change. The columns are those of the last definition (20261119000000), in the
-- same order.
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
      limit 6
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
  -- How many comments the memory has. The view runs with the reader's rights, so the comments'
  -- own rules decide what is counted; `comments_memory` makes it an index lookup, and it is
  -- worked out only for the memories of the page asked for.
  (select count(*) from public.comments c where c.memory_id = m.id)::integer as comment_count,
  -- The date as shown: the clock time in the chat's time zone. No zone, so it is the same
  -- wherever the reader is.
  (m.at at time zone c.timezone) as local_at
from public.memories m
join public.chats c on c.id = m.chat_id
where exists (select 1 from public.photos p where p.memory_id = m.id);
