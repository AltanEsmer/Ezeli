-- Comments (issue 18): a note a person adds to a memory, in the app. Not part of the old chat.
--
-- The rules, in one place:
--   read    a person with a live session
--   add     a person with a live session, as themselves only, with the time the database says
--   delete  their own; an owner any
--   edit    nobody
--   visitor nothing
-- Every rule asks private.current_person_id(), like the rest of the sign-in pattern, so a person
-- whose session is gone (signed out, link replaced) can do nothing at once.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  -- `restrict`, not cascade: the import's regroup moves comments to the memory that now holds the
  -- old one's first photo (followsMemory, cli/import/regroup.ts). A table that points at memories
  -- and is not listed there stops the import instead of losing rows silently.
  memory_id uuid not null references public.memories (id) on delete restrict,
  -- Always the caller: the column is not in the insert right, so this default is the only way in.
  person_id uuid not null default private.current_person_id() references public.people (id),
  -- Plain text exactly as written: not empty, no space or line break at either end, at most 2000
  -- characters. Line breaks inside are kept. The app shows it as text, never as markup.
  -- A text of only invisible characters (zero-width space and the like) counts as empty.
  body text not null check (
    body ~ '^\S([\s\S]*\S)?$'
    and char_length(body) <= 2000
    and body !~ '^[\s­͏᠎​-‏ - ⁠-⁯﻿]*$'
  ),
  created_at timestamptz not null default now()
);
create index comments_memory on public.comments (memory_id, created_at, id);
create index comments_person on public.comments (person_id);

alter table public.comments enable row level security;

revoke all on public.comments from anon, authenticated;
grant select, delete on public.comments to authenticated;
-- Only these two columns: who wrote it and when are never the caller's to choose, and there is
-- no update right at all.
grant insert (memory_id, body) on public.comments to authenticated;

create policy "people with a live session read comments" on public.comments
  for select to authenticated
  -- Only while the memory itself is readable by the caller (memories' own rules apply inside),
  -- so a memory that becomes unreadable (hiding, issue 20) takes its comments out of reach too.
  using (
    (select private.current_person_id()) is not null
    and exists (select 1 from public.memories m where m.id = comments.memory_id)
  );

create policy "a person adds a comment as themselves" on public.comments
  for insert to authenticated
  with check (
    person_id = (select private.current_person_id())
    and exists (select 1 from public.memories m where m.id = comments.memory_id)
  );

create policy "a person deletes their own comment, an owner any" on public.comments
  for delete to authenticated
  using (
    person_id = (select private.current_person_id())
    or exists (select 1 from public.people o where o.id = (select private.current_person_id()) and o.is_owner)
  );
