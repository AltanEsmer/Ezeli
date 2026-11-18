-- Hiding (issue 20). A hidden thing is not flagged, it is gone: the owners' command removes the
-- stored rows and photo files that a mark matches, and the import leaves matching things out. So the
-- read rules of memories, messages, photos, comments and the bucket are the same as before; nothing
-- here is a hiding check on a read.
--
-- A mark names the chat, the person, the clock minute, the kind and what to match (see
-- cli/import/marks.ts). Only the owners' commands (secret key) read or write it.
create table public.hidden (
  id uuid primary key default gen_random_uuid(),
  chat_key text not null,
  person_slug text not null,
  minute timestamptz not null,
  kind text not null check (kind in ('photo', 'text', 'other')),
  -- A photo's file hash ('' when it has none), a text message's text, '' for other media.
  match text not null default '',
  -- Set once the mark has matched exactly: from then on it hides only exact matches among what is
  -- stored, so a thing of the same minute that is not it is not hidden after the exact one is gone.
  exact boolean not null default false,
  hidden_at timestamptz not null default now()
);
create index hidden_chat on public.hidden (chat_key);
alter table public.hidden enable row level security;
revoke all on public.hidden from anon, authenticated;

-- The hash of the photo's original file, so hiding it can find it again whatever its key is.
alter table public.photos add column content_hash text;

-- The secret every lasting key of a chat is made with (cli/import/keys.ts). Made at the chat's first
-- import. Null for a chat stored before this, which keeps its keys.
alter table public.chats add column secret text;

-- Signed-in people read every column but these two: a key made with a secret they cannot read cannot
-- be worked out from what they can, and a file hash tells nothing they need.
revoke select on public.chats from authenticated;
grant select (id, key, name, app, timezone) on public.chats to authenticated;
revoke select on public.photos from authenticated;
grant select (id, memory_id, message_id, key, person_id, at, seq, view_path, thumb_path, width, height) on public.photos to authenticated;
