-- Search (issue 19): one function that finds memories by words from their messages, their comments,
-- or the name of a person who sent a photo or a message in them.
--
-- A typed word matches at the start of a word (the start of the text, or after anything that is not
-- a letter or a digit), in messages, comments and names alike: "ista" finds "İstanbul", "sarki"
-- finds "şarkı", but "ali" does not find "Şeftali" and "ece" does not find "gece".

create extension if not exists pg_trgm with schema extensions;

-- The one way text is made comparable, used on the stored text and on what the friend typed, so
-- both sides are the same. Letters written as a letter plus a combining mark become the one
-- character first (NFC), so both ways of typing "é" or "ş" are the same. Capital letters do not
-- matter, and the Turkish letters are folded to their plain ones in both directions: İ, I and ı
-- are all "i", and ş ğ ü ö ç (and â î û) are s g u o c. A name or word typed without Turkish
-- letters therefore finds the one with them. Other accents are kept (é stays é). The folding is
-- done before `lower`, so it does not depend on the database's locale.
create function private.fold(text) returns text
language sql immutable parallel safe set search_path = ''
as $$
  select lower(translate(normalize($1, NFC),
    'İIıŞşĞğÜüÖöÇçÂâÎîÛû' || U&'\0307\0306\0308\0327\0302\0301',
    'iiissgguuooccaaiiuu'))
$$;
-- A pure function of its text: anyone who writes a row (the import) needs it for the indexes below.
grant usage on schema private to service_role;

-- A folded word as a regular expression that finds it only at the start of a word: every character
-- that is not a letter or a digit is escaped, so the word is plain text. The trigram indexes below
-- narrow by it when the word has three letters or digits in a row.
create function private.word_start(text) returns text
language sql immutable parallel safe set search_path = ''
as $$ select '(^|[^[:alnum:]])' || regexp_replace($1, '([^[:alnum:]])', '\\\1', 'g') $$;

-- Trigram indexes on the folded text, fast on a large archive.
create index messages_folded on public.messages using gin (private.fold(text) extensions.gin_trgm_ops);
create index comments_folded on public.comments using gin (private.fold(body) extensions.gin_trgm_ops);
-- (Names use `messages (person_id, memory_id)`, which the people screens already index.)

-- Why two functions. Row level security makes the planner run its rules before any condition that
-- is not "leakproof", and `like` on our folded text is not, so under the caller's own rights the
-- trigram indexes above cannot be used and a search reads every message (1.6 s on 400,000).
-- So the candidates are found by `private.search_memory_ids`, which runs with the owner's rights
-- (and so uses the indexes) and answers only a person with a live session. `search_memories`,
-- which runs with the caller's rights, then checks every candidate again against what the caller
-- can read: a memory is returned only if each word is found in a message, comment or name that the
-- caller's own rules let them read, and the memory itself comes from the `timeline` view.
-- A word with no three letters or digits in a row ("ab", "...", an emoji) cannot use the index. Beside
-- a longer word it is only checked on the candidates; alone, the memories are walked from the newest
-- and checked (quick when the words are common, a few seconds on 400,000 messages when they are
-- rare). The app searches such words only on Enter.

-- The memories, newest first (the timeline's order) after the cursor `(p_at, p_key)`, that have
-- each of the folded words (see above) in a message, a comment, or the name of someone who sent a
-- message or photo in them. At most `p_limit`. Nothing for a visitor or a person whose session has
-- ended.
create function private.search_memory_ids(p_words text[], p_at timestamp, p_key text, p_limit integer)
returns table (id uuid, local_at timestamp, key text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  word text;
  found uuid[];
  hits uuid[];
  starts text;
  starting text[];
begin
  if (select private.current_person_id()) is null then
    return;
  end if;
  starting := array(select private.word_start(w) from unnest(p_words) w);
  foreach word in array p_words loop
    -- Only a word with three letters or digits in a row narrows by index; the others are checked below.
    continue when word !~ '[[:alnum:]]{3}';
    starts := private.word_start(word);
    hits := array(
      select m.memory_id from public.messages m where private.fold(m.text) ~ starts
      union
      select c.memory_id from public.comments c where private.fold(c.body) ~ starts
      union
      select m.memory_id from public.messages m
      where m.person_id in (select p.id from public.people p where private.fold(p.display_name) ~ starts)
    );
    found := case when found is null then hits else array(select unnest(found) intersect select unnest(hits)) end;
    exit when found = '{}';
  end loop;
  if found = '{}' then
    return;
  end if;
  -- found is null: no word the index can look up, so walk the memories from the newest and keep those
  -- that have every word. (`|| ''` keeps this from using the trigram indexes: for a short word a lookup
  -- there reads the whole index for each memory, while the memory's own rows are cheap.)
  return query
    select m.id, (m.at at time zone c.timezone), m.key
    from public.memories m
    join public.chats c on c.id = m.chat_id
    where (found is null or m.id = any (found))
      and exists (select 1 from public.photos p where p.memory_id = m.id)
      and (found is not null or not exists (
        select 1 from unnest(starting) w
        where not (
          exists (select 1 from public.messages x where x.memory_id = m.id and (private.fold(x.text) || '') ~ w)
          or exists (select 1 from public.comments x where x.memory_id = m.id and (private.fold(x.body) || '') ~ w)
          or exists (
            select 1 from public.messages x join public.people p on p.id = x.person_id
            where x.memory_id = m.id and private.fold(p.display_name) ~ w
          )
        )
      ))
      and (p_at is null or ((m.at at time zone c.timezone), m.key) < (p_at, p_key))
    order by (m.at at time zone c.timezone) desc, m.key desc
    limit p_limit;
end;
$$;
revoke all on function private.search_memory_ids(text[], timestamp, text, integer) from public;
grant execute on function private.search_memory_ids(text[], timestamp, text, integer) to authenticated;

-- One page of search results: memories in the timeline's order (newest first) after the cursor
-- `(p_at, p_key)`, or the newest with no cursor, at most 100. Every word of `p_query` (split on
-- whitespace; the first 8 in typed order are used) must be found at the start of a word in the
-- memory: in a message, in a comment, or in the name of someone who sent a photo or a message in
-- it (different words may be found in different places). The typed text is plain: `%`, `_`, `\`
-- and the like mean themselves. Runs with the caller's rights.
create function public.search_memories(p_query text, p_at timestamp default null, p_key text default null, p_limit integer default 20)
returns setof public.timeline
language plpgsql stable security invoker set search_path = ''
as $$
declare
  words text[];
  starting text[];
  want integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  got integer := 0;
  cur_at timestamp := p_at;
  cur_key text := p_key;
  ids uuid[];
  asked integer := 100;
  cid uuid;
  r public.timeline;
begin
  words := array(
    select g.w from (
      select t.w, min(t.n) as n
      from regexp_split_to_table(private.fold(left(coalesce(p_query, ''), 1000)), '\s+') with ordinality as t(w, n)
      where t.w <> ''
      group by t.w
    ) g
    order by g.n
    limit 8
  );
  if cardinality(words) = 0 then
    return;
  end if;
  starting := array(select private.word_start(w) from unnest(words) w);
  loop
    ids := '{}';
    for cid, cur_at, cur_key in select c.id, c.local_at, c.key from private.search_memory_ids(words, cur_at, cur_key, asked) c loop
      ids := ids || cid;
    end loop;
    exit when cardinality(ids) = 0;
    for r in
      select t.* from public.timeline t
      where t.id = any (ids)
        and not exists (
          select 1 from unnest(starting) w
          where not (
            exists (select 1 from public.messages m where m.memory_id = t.id and private.fold(m.text) ~ w)
            or exists (select 1 from public.comments c where c.memory_id = t.id and private.fold(c.body) ~ w)
            or exists (
              select 1 from public.messages m join public.people p on p.id = m.person_id
              where m.memory_id = t.id and private.fold(p.display_name) ~ w
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
