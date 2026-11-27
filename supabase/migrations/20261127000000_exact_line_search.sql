-- Keep the existing indexed memory search and rank visible lines only on the returned page.
create function public.search_memories_with_matches(
  p_query text, p_at timestamp default null, p_key text default null, p_limit integer default 20
)
returns setof jsonb
language sql stable security invoker set search_path = ''
as $$
  with typed as (
    select w, n
    from regexp_split_to_table(private.fold(left(coalesce(p_query, ''), 1000)), '\s+')
      with ordinality as parts(w, n)
    where w <> ''
  ), query as (
    select array(
             select private.word_start(w) from typed group by w order by min(n) limit 8
           ) as words,
           private.word_start(string_agg(w, ' ' order by n)) || '($|[^[:alnum:]])' as phrase
    from typed
  )
  select to_jsonb(t) || jsonb_build_object('match', best.hit)
  from public.search_memories(p_query, p_at, p_key, p_limit) t
  cross join query q
  left join lateral (
    select jsonb_build_object('id', x.id, 'kind', x.kind, 'quote', x.body) as hit
    from (
      select id, text as body, 'message' as kind, 0 as priority, at, seq
      from public.messages where memory_id = t.id
      union all
      select id, body, 'comment', 1, created_at, 0
      from public.comments where memory_id = t.id
    ) x
    cross join lateral (select private.fold(x.body) as body) folded
    where folded.body ~ all (q.words)
    order by (regexp_replace(folded.body, '\s+', ' ', 'g') ~ q.phrase) desc,
             x.priority, x.at, x.seq, x.id
    limit 1
  ) best on true
  order by t.local_at desc, t.key desc
$$;

revoke all on function public.search_memories_with_matches(text, timestamp, text, integer) from public, anon;
grant execute on function public.search_memories_with_matches(text, timestamp, text, integer) to authenticated;
