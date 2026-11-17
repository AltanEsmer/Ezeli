-- Hiding (issue 20): an owner hides a message, a photo or a whole memory. Nothing hidden can be read
-- by a signed-in person, on any screen: the rule lives here, in the access rules, so every table,
-- view and function that reads through them gets it.
--
-- A hidden mark hangs on the thing itself, by its lasting key (a photo's key is also the key of its
-- message), not on a memory. A later import or regroup moves things between memories but never
-- changes their keys, so a mark cannot be lost and the import never brings the thing back. Hiding a
-- whole memory marks every photo and message it holds at that moment.
create table public.hidden (
  key text primary key,
  hidden_at timestamptz not null default now()
);
-- Only the owners' command (secret key) reads or writes it. A signed-in person cannot even see
-- that a mark exists.
alter table public.hidden enable row level security;
revoke all on public.hidden from anon, authenticated;

create function private.is_hidden(p_key text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.hidden h where h.key = p_key) $$;
revoke all on function private.is_hidden(text) from public;
grant execute on function private.is_hidden(text) to authenticated;

-- Messages and photos: a hidden one is not there. A message is also not there when its memory is not
-- (see below): the conversation of a memory that appears nowhere cannot be read from the table.
drop policy "people with a live session read" on public.messages;
create policy "people with a live session read what is not hidden" on public.messages
  for select to authenticated
  using (
    (select private.current_person_id()) is not null
    and not private.is_hidden(key)
    and exists (select 1 from public.memories m where m.id = messages.memory_id)
  );

drop policy "people with a live session read" on public.photos;
create policy "people with a live session read what is not hidden" on public.photos
  for select to authenticated
  using ((select private.current_person_id()) is not null and not private.is_hidden(key));

-- A memory is there only while it has a photo that is not hidden (the photos are read through their
-- own rule). So a memory whose photos are all hidden is on no screen, and its address answers like
-- an address that does not exist. The timeline, `memory_detail`, the counts, the senders and the
-- memory before and after all read memories and photos with the reader's rights, so they follow.
drop policy "people with a live session read" on public.memories;
create policy "people with a live session read memories with a photo" on public.memories
  for select to authenticated
  using (
    (select private.current_person_id()) is not null
    and exists (select 1 from public.photos p where p.memory_id = memories.id)
  );

-- The files of a hidden photo are removed by the owner's command; this is the second lock, for the
-- moment between the mark and the removal. File names are `<chat id>/<photo key>-view.webp` and
-- `-thumb.webp`.
drop policy "people with a live session read photos" on storage.objects;
create policy "people with a live session read photos" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (select private.current_person_id()) is not null
    and not private.is_hidden(regexp_replace(storage.filename(name), '-(view|thumb)\.webp$', ''))
  );
