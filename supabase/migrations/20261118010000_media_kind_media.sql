-- Android's "media omitted" does not say what was sent. It is kept as its own kind of media.
alter table public.messages drop constraint messages_media_kind_check;
alter table public.messages
  add constraint messages_media_kind_check
  check (media_kind in ('photo', 'video', 'gif', 'voice', 'document', 'media'));
