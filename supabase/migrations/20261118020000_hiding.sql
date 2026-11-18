-- Hiding (issue 20): an owner hides a message, a photo or a whole memory. Nothing hidden can be read
-- by a signed-in person, on any screen: the rule lives here, in the access rules, so every table,
-- view and function that reads through them gets it.
--
-- A hidden thing is treated as if it was never sent. The owners' command flags a message `hidden`,
-- removes a hidden photo's row and files, and leaves the memory as an import would (see cli/hide.ts).
-- The rules below are plain column checks and index lookups: no function runs per row.
--
-- The table `hidden` is what lasts. It remembers each hidden thing by its lasting key and, since a
-- key can shift when an earlier message of the same minute goes away, also by what it is: a photo by
-- the hash of its file, a text message by chat, minute, sender and text. The import reads it and
-- leaves matching things out before it groups. Only the owners' command (secret key) uses it.
create table public.hidden (
  key text primary key,
  chat_key text not null,
  content_hash text,
  minute timestamptz,
  person_slug text,
  text text,
  hidden_at timestamptz not null default now()
);
create index hidden_chat on public.hidden (chat_key);
alter table public.hidden enable row level security;
revoke all on public.hidden from anon, authenticated;

-- Flags kept by the owners' command. A message is hidden when it is marked, or when its memory is;
-- a memory is hidden when every photo message in it is marked (it is then on no screen).
alter table public.messages add column hidden boolean not null default false;
alter table public.memories add column hidden boolean not null default false;
alter table public.photos add column hidden boolean not null default false;
-- The hash of the photo's original file, so hiding it can be remembered whatever its key becomes.
alter table public.photos add column content_hash text;

-- Messages, photos and memories: a hidden one is not there. Plain column checks, so the database can
-- use its indexes and no function runs per row. The timeline, `memory_detail`, counts, senders, the
-- memory before and after, and every later screen read these tables with the reader's rights, so
-- they follow.
drop policy "people with a live session read" on public.messages;
create policy "people with a live session read what is not hidden" on public.messages
  for select to authenticated
  using ((select private.current_person_id()) is not null and not hidden);

drop policy "people with a live session read" on public.photos;
create policy "people with a live session read what is not hidden" on public.photos
  for select to authenticated
  using ((select private.current_person_id()) is not null and not hidden);

drop policy "people with a live session read" on public.memories;
create policy "people with a live session read what is not hidden" on public.memories
  for select to authenticated
  using ((select private.current_person_id()) is not null and not hidden);
create index memories_at_key on public.memories (at desc, key desc);

-- Files of a photo that is flagged hidden but not yet removed (the command removes the files, then
-- the row). Looked up by file name in a small index; runs once per file asked for, never per row.
create index photos_hidden_view on public.photos (view_path) where hidden;
create index photos_hidden_thumb on public.photos (thumb_path) where hidden;
create function private.file_is_hidden(p_name text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.photos p where p.hidden and (p.view_path = p_name or p.thumb_path = p_name)) $$;
revoke all on function private.file_is_hidden(text) from public;
grant execute on function private.file_is_hidden(text) to authenticated;

drop policy "people with a live session read photos" on storage.objects;
create policy "people with a live session read photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (select private.current_person_id()) is not null
    and not private.file_is_hidden(name)
  );
