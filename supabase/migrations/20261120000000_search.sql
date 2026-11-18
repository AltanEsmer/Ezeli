-- Search (issue 19): one function that finds memories by words from their messages, their comments,
-- or the name of a person who sent a photo or a message in them.

create extension if not exists pg_trgm with schema extensions;

-- The one way text is made comparable, used on the stored text and on what the friend typed, so
-- both sides are the same. Capital letters do not matter, and the Turkish letters are folded to
-- their plain ones in both directions: İ, I and ı are all "i", and ş ğ ü ö ç (and â î û) are s g
-- u o c. A name or word typed without Turkish letters therefore finds the one with them.
-- Combining marks (a dot above, a cedilla, ...) from decomposed text are dropped. This is done
-- before `lower`, so it does not depend on the database's locale.
create function private.fold(text) returns text
language sql immutable parallel safe set search_path = ''
as $$
  select lower(translate($1,
    'İIıŞşĞğÜüÖöÇçÂâÎîÛû' || U&'\0307\0306\0308\0327\0302\0301',
    'iiissgguuooccaaiiuu'))
$$;
-- A pure function of its text: anyone who writes a row (the import) needs it for the indexes below.
grant usage on schema private to service_role;

-- Substring search on the folded text, fast on a large archive.
create index messages_folded on public.messages using gin (private.fold(text) extensions.gin_trgm_ops);
create index comments_folded on public.comments using gin (private.fold(body) extensions.gin_trgm_ops);
-- Which memories a person has written in.
create index messages_person on public.messages (person_id, memory_id);

-- Why two functions. Row level security makes the planner run its rules before any condition that
-- is not "leakproof", and `like` on our folded text is not, so under the caller's own rights the
-- trigram indexes above cannot be used and a search reads every message (1.6 s on 400,000).
-- (A word of one or two letters has no trigram, so it cannot narrow by index at all: it is left to
-- the check, and with no longer word the memories are walked from the newest.)
-- So the candidates are found by `private.search_memory_ids`, which runs with the owner's rights
-- (and so uses the indexes) and answers only a person with a live session. `search_memories`,
-- which runs with the caller's rights, then checks every candidate again against what the caller
-- can read: a memory is returned only if each word is found in a message, comment or name that the
-- caller's own rules let them read, and the memory itself comes from the `timeline` view.

-- The memories, newest first (the timeline's order) after the cursor `(p_at, p_key)`, that have
-- each of the patterns (`like` patterns on folded text; `p_all` has all the words, `p_patterns`
-- only those long enough for the index) in a message, a comment, or the name of
-- someone who sent a message or photo in them. At most `p_limit`. Nothing for a visitor or a
-- person whose session has ended.
create function private.search_memory_ids(p_patterns text[], p_all text[], p_at timestamp, p_key text, p_limit integer)
returns table (id uuid, local_at timestamp, key text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pattern text;
  found uuid[];
  hits uuid[];
begin
  if (select private.current_person_id()) is null then
    return;
  end if;
  -- No pattern the index can look up (only words of one or two letters): walk the memories from the
  -- newest, keeping those that have every word (`p_all`).
  if cardinality(p_patterns) = 0 then
    return query
      select m.id, (m.at at time zone c.timezone), m.key
      from public.memories m
      join public.chats c on c.id = m.chat_id
      where exists (select 1 from public.photos p where p.memory_id = m.id)
        and not exists (
          select 1 from unnest(p_all) w
          where not (
            -- (`|| ''` keeps these from using the trigram indexes: for a word of one or two letters a
            -- lookup there reads the whole index for each memory; the memory's own rows are cheap.)
            exists (select 1 from public.messages x where x.memory_id = m.id and (private.fold(x.text) || '') like w)
            or exists (select 1 from public.comments x where x.memory_id = m.id and (private.fold(x.body) || '') like w)
            or exists (
              select 1 from public.messages x join public.people p on p.id = x.person_id
              where x.memory_id = m.id and private.fold(p.display_name) like w
            )
          )
        )
        and (p_at is null or ((m.at at time zone c.timezone), m.key) < (p_at, p_key))
      order by (m.at at time zone c.timezone) desc, m.key desc
      limit p_limit;
    return;
  end if;
  foreach pattern in array p_patterns loop
    hits := array(
      select m.memory_id from public.messages m where private.fold(m.text) like pattern
      union
      select c.memory_id from public.comments c where private.fold(c.body) like pattern
      union
      select m.memory_id from public.messages m
      where m.person_id in (select p.id from public.people p where private.fold(p.display_name) like pattern)
    );
    found := case when found is null then hits else array(select unnest(found) intersect select unnest(hits)) end;
    exit when found = '{}';
  end loop;
  if found is null or found = '{}' then
    return;
  end if;
  return query
    select m.id, (m.at at time zone c.timezone), m.key
    from public.memories m
    join public.chats c on c.id = m.chat_id
    where m.id = any (found)
      and exists (select 1 from public.photos p where p.memory_id = m.id)
      and (p_at is null or ((m.at at time zone c.timezone), m.key) < (p_at, p_key))
    order by (m.at at time zone c.timezone) desc, m.key desc
    limit p_limit;
end;
$$;
revoke all on function private.search_memory_ids(text[], text[], timestamp, text, integer) from public;
grant execute on function private.search_memory_ids(text[], text[], timestamp, text, integer) to authenticated;

-- One page of search results: memories in the timeline's order (newest first) after the cursor
-- `(p_at, p_key)`, or the newest with no cursor, at most 100. Every word of `p_query` (split on
-- whitespace, at most 8) must be found in the memory: in a message, in a comment, or in the name
-- of someone who sent a photo or a message in it (different words may be found in different
-- places). A word is matched as plain text anywhere inside the stored text: `%`, `_` and `\` mean
-- themselves. Runs with the caller's rights.
create function public.search_memories(p_query text, p_at timestamp default null, p_key text default null, p_limit integer default 20)
returns setof public.timeline
language plpgsql stable security invoker set search_path = ''
as $$
declare
  words text[];
  patterns text[];
  indexed text[];
  want integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  got integer := 0;
  cur_at timestamp := p_at;
  cur_key text := p_key;
  ids uuid[];
  asked integer;
  cid uuid;
  r public.timeline;
begin
  words := array(select distinct w from regexp_split_to_table(private.fold(left(coalesce(p_query, ''), 200)), '\s+') w where w <> '' limit 8);
  if cardinality(words) = 0 then
    return;
  end if;
  -- Each word as a `like` pattern that matches it as plain text anywhere inside.
  patterns := array(select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%' from unnest(words) w);
  -- The words of three letters or more narrow the candidates by index; shorter ones only count in the check.
  indexed := array(select '%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%' from unnest(words) w where char_length(w) >= 3);
  loop
    asked := 100;
    ids := '{}';
    for cid, cur_at, cur_key in select c.id, c.local_at, c.key from private.search_memory_ids(indexed, patterns, cur_at, cur_key, asked) c loop
      ids := ids || cid;
    end loop;
    exit when cardinality(ids) = 0;
    for r in
      select t.* from public.timeline t
      where t.id = any (ids)
        and not exists (
          select 1 from unnest(patterns) w
          where not (
            exists (select 1 from public.messages m where m.memory_id = t.id and private.fold(m.text) like w)
            or exists (select 1 from public.comments c where c.memory_id = t.id and private.fold(c.body) like w)
            or exists (
              select 1 from public.messages m join public.people p on p.id = m.person_id
              where m.memory_id = t.id and private.fold(p.display_name) like w
            )
          )
        )
      order by t.local_at desc, t.key desc
    loop
      return next r;
      got := got + 1;
      exit when got >= want;
    end loop;
    -- A short batch was the end of the candidates; a full one may have lost some to the check above.
    exit when got >= want or cardinality(ids) < asked;
  end loop;
end;
$$;
revoke all on function public.search_memories(text, timestamp, text, integer) from public, anon, authenticated;
grant execute on function public.search_memories(text, timestamp, text, integer) to authenticated;
