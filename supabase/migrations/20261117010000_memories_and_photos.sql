-- What the import stores: chats, memories, messages, photos. Friends read; nobody writes from
-- the app. The import writes with the secret key on the owner's computer.
--
-- Every table has a lasting `key` that is made from the chat's content, not from this database,
-- so a later import recognises what it saw before (issue 13) and hidden marks can stay attached
-- (issue 20). The import makes the keys; they are never shown.

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  -- The owner names the chat when importing. Importing a newer export under the same name is the
  -- same chat. Key = app + the name with case and surrounding spaces ignored.
  key text not null unique,
  name text not null check (btrim(name) <> ''),
  app text not null check (app in ('whatsapp', 'discord')),
  -- The time zone the chat's clock times were read in. Dates are shown in it.
  timezone text not null
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  -- The chat's key plus the key of the memory's first photo.
  key text not null unique,
  -- When the first photo was sent.
  at timestamptz not null
);
create index memories_at on public.memories (at desc);
create index memories_chat on public.memories (chat_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories (id) on delete cascade,
  -- The chat, when it was sent, who sent it, its content, and a count for identical ones in the
  -- same moment. The export has no message ids.
  key text not null unique,
  person_id uuid not null references public.people (id),
  at timestamptz not null,
  -- Position inside the memory: messages sent in the same second keep their order.
  seq integer not null,
  -- What was written, exactly. Empty for media.
  text text not null,
  -- The kind of media the message carried: photo, video, gif, voice or document. Only photos are
  -- kept (see `photos`); the others show as a short placeholder line.
  media_kind text check (media_kind in ('photo', 'video', 'gif', 'voice', 'document'))
);
create index messages_memory on public.messages (memory_id, at, seq);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories (id) on delete cascade,
  -- The photo's message in the chat. It carries the photo's key.
  message_id uuid not null unique references public.messages (id) on delete cascade,
  key text not null unique,
  person_id uuid not null references public.people (id),
  at timestamptz not null,
  seq integer not null,
  -- Where the two stored sizes are in the private bucket `photos`.
  view_path text not null,
  thumb_path text not null,
  -- The size of the viewing version, so a screen can keep room for it.
  width integer not null,
  height integer not null
);
create index photos_memory on public.photos (memory_id, at, seq);

-- Access: a signed-in person with a live session reads. Nobody else reads, and nobody writes.
do $$
declare t text;
begin
  foreach t in array array['chats', 'memories', 'messages', 'photos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format(
      'create policy "people with a live session read" on public.%I for select to authenticated using ((select private.current_person_id()) is not null)',
      t
    );
  end loop;
end $$;

-- The timeline in one request: memories newest first, each with its main photos (the first
-- three, by their small size), how many there are, and who sent them. The view runs with the
-- reader's rights, so the access rules above apply to it.
create view public.timeline with (security_invoker = true) as
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
  ) as senders
from public.memories m
join public.chats c on c.id = m.chat_id;

revoke all on public.timeline from anon, authenticated;
grant select on public.timeline to authenticated;

-- Photos live in one private bucket. Only the two stored sizes go in, as WebP; originals never.
-- The app reaches them through links that stop working after an hour.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/webp']);

create policy "people with a live session read photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (select private.current_person_id()) is not null);
