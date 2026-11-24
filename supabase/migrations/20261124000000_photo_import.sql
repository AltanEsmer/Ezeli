alter table public.chats drop constraint chats_app_check;
alter table public.chats add constraint chats_app_check check (app in ('whatsapp', 'discord', 'manual'));
alter table public.memories add column place text check (char_length(place) <= 160);

create policy "friends upload photos under their own id" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'photos'
    and split_part(name, '/', 1) = 'manual'
    and split_part(name, '/', 2) = (select private.current_person_id())::text
    and split_part(name, '/', 3) ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}-(view|thumb)[.]webp$'
    and cardinality(string_to_array(name, '/')) = 3
  );

alter policy "people with a live session read photos" on storage.objects using (
  bucket_id = 'photos' and (select private.current_person_id()) is not null
  and (
    name not like 'manual/%'
    or split_part(name, '/', 2) = (select private.current_person_id())::text
    or exists (
      select 1 from public.photos p
      where p.key = 'manual:' || left(split_part(objects.name, '/', 3), 36)
        and objects.name in (p.view_path, p.thumb_path)
    )
  )
);

-- Store a memory, its photo and its optional comment together. The id stays the same
-- when the browser retries an upload whose response was lost.
create function public.import_photo(
  p_id uuid, p_at timestamptz, p_timezone text, p_place text, p_comment text, p_width integer, p_height integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.current_person_id();
  item_key text := 'manual:' || p_id::text;
  source_key text := 'manual:' || p_timezone;
  prefix text := 'manual/' || me::text || '/' || p_id::text;
  chat uuid;
  memory uuid;
  message uuid;
begin
  if me is null or (select count(*) from storage.objects where bucket_id = 'photos'
      and name in (prefix || '-view.webp', prefix || '-thumb.webp')) <> 2 then
    raise exception 'Photo files are missing or the session has ended';
  end if;

  if p_at is null or not isfinite(p_at) or p_width is null or p_height is null
    or p_width not between 1 and 1600 or p_height not between 1 and 1600
    or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone)
    or p_place is null or p_comment is null or char_length(p_comment) > 2000 then
    raise exception 'Invalid photo details';
  end if;

  insert into public.chats (key, app, name, timezone)
  values (source_key, 'manual', 'Ezeli', p_timezone)
  on conflict (key) do nothing;
  select id into chat from public.chats where key = source_key;

  insert into public.memories (chat_id, key, at, place)
  values (chat, item_key, p_at, btrim(p_place))
  on conflict (key) do nothing returning id into memory;

  if memory is null then
    if exists (select 1 from public.photos where key = item_key and person_id = me) then
      return;
    end if;
    raise exception 'Photo id already in use';
  end if;

  insert into public.messages (memory_id, key, person_id, at, seq, text, media_kind)
  values (memory, item_key, me, p_at, 0, '', 'photo') returning id into message;

  insert into public.photos (memory_id, message_id, key, person_id, at, seq, view_path, thumb_path, width, height)
  values (memory, message, item_key, me, p_at, 0, prefix || '-view.webp', prefix || '-thumb.webp', p_width, p_height);

  if p_comment <> '' then
    insert into public.comments (memory_id, person_id, body) values (memory, me, p_comment);
  end if;
end;
$$;

revoke all on function public.import_photo(uuid, timestamptz, text, text, text, integer, integer) from public, anon;
grant execute on function public.import_photo(uuid, timestamptz, text, text, text, integer, integer) to authenticated;

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
