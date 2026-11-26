-- Only the capture point from the original is retained. The two stored files stay metadata-free.
alter table public.photos
  add column latitude double precision,
  add column longitude double precision,
  add constraint photos_location_pair check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null
      and latitude between -90 and 90 and longitude between -180 and 180)
  );

grant select (latitude, longitude) on public.photos to authenticated;

-- Hiding deletes the photo or its memory. The view inherits the same live-session read rules.
create view public.located_photos with (security_invoker = true) as
select p.message_id, m.key as memory_key, p.latitude, p.longitude, p.thumb_path, pe.display_name
from public.photos p
join public.memories m on m.id = p.memory_id
join public.people pe on pe.id = p.person_id
where p.latitude is not null;

revoke all on public.located_photos from anon, authenticated;
grant select on public.located_photos to authenticated;
