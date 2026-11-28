alter table public.messages add column clip_digest text check (clip_digest ~ '^[0-9a-f]{32}$');

-- Serialize a clip's writes with recording its hide. A write that gets the lock
-- first is visible to the hide's cleanup. A later write sees the mark and skips.
create function private.lock_clip_hide() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind = 'other' and new.match like 'clip:%' then
    perform pg_advisory_xact_lock(hashtextextended(new.chat_key, 0));
  end if;
  return new;
end;
$$;

create trigger lock_clip_hide before insert on public.hidden
for each row execute function private.lock_clip_hide();

create function private.skip_hidden_clip() returns trigger
language plpgsql set search_path = '' as $$
declare
  chat text;
  person text;
begin
  if new.media_kind is null or new.media_kind not in ('video', 'voice', 'media') then
    return new;
  end if;

  select c.key into chat from public.memories m join public.chats c on c.id = m.chat_id
    where m.id = new.memory_id;
  perform pg_advisory_xact_lock(hashtextextended(chat, 0));
  select coalesce(p.slug, p.id::text) into person from public.people p where p.id = new.person_id;

  if exists (
    select 1 from public.hidden h
    where h.chat_key = chat and h.person_slug = person
      and h.minute = date_trunc('minute', new.at)
      and h.kind = 'other' and h.match like 'clip:%'
      and (
        (split_part(h.match, ':', 2) = new.key
          and (split_part(h.match, ':', 3) = '' or new.clip_source is null))
        or split_part(h.match, ':', 3) = new.clip_source
        or (
          split_part(h.match, ':', 4) = new.clip_digest
          and not exists (
            select 1 from public.messages sibling where sibling.key = new.key
              and sibling.clip_source = new.clip_source
              and split_part(h.match, ':', 3) <> sibling.clip_source
              and split_part(h.match, ':', 2) <> sibling.key
          )
        )
      )
  ) then
    return null;
  end if;
  return new;
end;
$$;

create trigger skip_hidden_clip before insert or update on public.messages
for each row execute function private.skip_hidden_clip();

revoke execute on function private.lock_clip_hide(), private.skip_hidden_clip() from public, anon, authenticated;
