-- The two trailing defaults keep the existing seven-argument client compatible.
drop function public.import_photo(uuid, timestamptz, text, text, text, integer, integer);

-- Store a memory, its photo and its optional comment together. The id stays the same
-- when the browser retries an upload whose response was lost.
create function public.import_photo(
  p_id uuid, p_at timestamptz, p_timezone text, p_place text, p_comment text, p_width integer, p_height integer,
  p_latitude double precision default null, p_longitude double precision default null
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

  insert into public.photos (
    memory_id, message_id, key, person_id, at, seq, view_path, thumb_path, width, height, latitude, longitude
  ) values (
    memory, message, item_key, me, p_at, 0, prefix || '-view.webp', prefix || '-thumb.webp',
    p_width, p_height, p_latitude, p_longitude
  );

  if p_comment <> '' then
    insert into public.comments (memory_id, person_id, body) values (memory, me, p_comment);
  end if;
end;
$$;

revoke all on function public.import_photo(uuid, timestamptz, text, text, text, integer, integer, double precision, double precision) from public, anon;
grant execute on function public.import_photo(uuid, timestamptz, text, text, text, integer, integer, double precision, double precision) to authenticated;
