alter table public.messages add column clip_path text unique
  check (clip_path ~ '^[0-9a-f-]+/[0-9a-f]+-clip[.](mp4|m4a)$'),
  add column clip_source text check (clip_source ~ '^[0-9a-f]{32}$');

revoke select on public.messages from authenticated;
grant select (id, memory_id, key, person_id, at, seq, text, media_kind, clip_path) on public.messages to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', false, 26214400, array['video/mp4', 'audio/mp4']);

-- Signed-in friends may sign the playback path while its message is visible.
create policy "people with a live session read clips" on storage.objects
for select to authenticated using (
  bucket_id = 'clips' and (select private.current_person_id()) is not null
  and exists (
    select 1 from public.messages g
    where g.clip_path = objects.name
      and exists (select 1 from public.photos p where p.memory_id = g.memory_id)
  )
);

create or replace function public.memory_detail(p_key text) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'at', m.at,
    'chat_name', c.name,
    'place', m.place,
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
        'id', g.id, 'by', pe.display_name, 'by_id', pe.slug, 'at', g.at, 'text', g.text, 'kind', g.media_kind, 'clip', g.clip_path
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
