# Sign-in and running locally

A friend opens a personal link and is signed in as themselves. No email, no password.

## How it works

- An owner runs `pnpm ezeli person add --name <display name> [--owner]`. It creates one Supabase Auth account for the person and a row in `people`, and prints the link. Display names are unique.
- `pnpm ezeli person relink --name <display name>` replaces a lost or leaked link: a new login id and a new secret in one admin call. The old link stops working, and Supabase ends every session of that person, so each of their devices shows the private page on its next load and needs the new link. The person and their comments stay the same.
- `pnpm ezeli person list` shows everyone, whether they have a link, whether they are an owner, how many comments they have written (counted from the comments themselves), and when they last opened their link. That time is `last_sign_in_at`, which Auth already keeps: nothing is tracked by us. Auth keeps only the latest sign-in, so it is the last opening, not the first. Auth's audit log could hold the first, but the secret key cannot read it through the API (it needs direct database access, which owner commands do not have). A sign-in from before a link was replaced does not count: the person shows "not yet" until they open the new link.
- The link is `https://<app>/#k=<login id>.<secret>`. The part after `#` never leaves the browser. The app signs in with it (the secret is the account's password), removes it from the address bar at once, and keeps the session on that device.
- The account's address is made up (`<login id>@ezeli.invalid`) and no mail is ever sent. Public sign-up is off (`supabase/config.toml`), so the only accounts are the ones the owners create.
- Every access rule asks one question, through `private.current_person_id()`: which person is this request, given that the session still exists? A signed-out device, or one whose link was replaced, reads nothing at once, not when its token runs out.
- Sign-out uses `signOut({ scope: 'local' })`: it ends this device only.
- Labels are in `src/i18n.ts`, English and Turkish. A person chooses in the menu; the choice is stored on the person (`people.language`, null until chosen) and follows them to another device. Until then the app follows the browser's language. `people` stays read-only for the app: the one write is the function `set_my_language(chosen)`, which sets the caller's own language and nothing else. `current_person()` returns it. In the app, `t` and `language` are live bindings that `setLanguage` changes; `App` re-renders on it, so a screen just imports them and a switch changes everything at once, without a reload.

On the hosted project (not set up yet) the same things are dashboard switches under Authentication: turn off "Allow new users to sign up", leave anonymous sign-ins off, keep the Email provider on, set no custom SMTP and no external providers. GraphQL is on by default on a hosted project: switch it off, or leave it unexposed (locally it is off). Then create one account and check that the hosted admin API accepts the `.invalid` address.

The secret key reaches owner commands only through the environment: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `EZELI_APP_URL`.

## Run it on your computer

Docker must be running. Each worktree gets its own Supabase.

```
pnpm install
sh scripts/supabase-env.sh                  # once per worktree; its own project id and ports
pnpm exec supabase start                    # about 6 s after the first download
eval "$(sh scripts/local-env.sh)"           # .env.local for the app; exports for the owner command
pnpm dev --host 127.0.0.1 --port 5173       # the port printed by local-env.sh
pnpm ezeli person add --name Karpuz --owner # prints the personal link; open it
```

Stop it with `pnpm exec supabase stop --no-backup` (never `--all`: that stops other worktrees' stacks).

## What a signed-in person can read

Added with the import (issue 11). The rules follow the sign-in pattern: every table has row level security, `anon` and `authenticated` lose all rights and `authenticated` gets `select` back, and every policy asks `private.current_person_id()`.

- `chats`, `memories`, `messages`, `photos` (and `people`): a person with a live session reads; nobody writes from the app; a visitor reads nothing.
- `timeline`: a view (`security_invoker`, so the rules above apply to it) of memories newest first with their first three photos, the photo count, the senders, its month (in the chat's time zone), one line of the conversation (the first text message at or after the first photo, else the last one before it) and `comment_count` (0 until issue 18), (a photo's caption counts as text), the memory's key, and `local_at`, in one request. One order everywhere: `local_at` (the date as shown: the clock time in the chat's time zone), then the key. The timeline reads it through `timeline_page(p_newer, p_at, p_key, p_limit, p_inclusive)`, a page of at most 100 after or before a cursor, so it can open at the newest, around a month or around a memory and grow both ways; `memory_detail`'s earlier and later use the same order. The year tabs read `timeline_months`. The screen keeps only the pages near it in the page.
- Signed links are only as short as the app asks for (an hour in `src/memories.ts`). A signed-in person can ask the server for a much longer link to one file; the server does not enforce the short life. A person can download every file anyway, so this is not worse, but it is a choice of the app, not a rule of the server.
- The bucket `photos` is private. A person with a live session can read objects, which is what lets the app ask for signed links (`createSignedUrls`, valid for an hour). Nobody can upload or remove from the app, and a visitor cannot list, download or sign.
- A new table or bucket needs the same three things: row level security on, rights revoked then `select` granted, and a policy through `current_person_id()`. The tests in `tests/import/access.test.ts` show what to check.

## Comments

Added with issue 18: the table `comments` (memory, person, text, time). Same pattern as above, every policy asks `private.current_person_id()`, so a person whose session is gone can do nothing at once.

- **Read:** a person with a live session. A visitor reads nothing.
- **Add:** a person with a live session, as themselves only. The insert right covers only `memory_id` and `body`: who wrote it (`person_id`, defaulted from the session) and when (`created_at`) are never the caller's to choose, and a policy checks the writer again.
- **Delete:** the writer's own; an owner any.
- **Edit:** nobody. There is no update right and no update policy.
- **The text:** plain, shown exactly as written (never as HTML), with its line breaks. The database refuses empty text, text with a space or line break at either end, and text over 2000 characters; the app trims before sending.
- **The import:** `comments.memory_id` is `on delete restrict` and listed in `followsMemory`, so comments follow a memory that disappears (see import.md, "What follows a memory that disappears").
- **Only on a readable memory:** read and add rules also ask that the caller can read the memory, so a memory that becomes unreadable (hiding, issue 20) takes its comments out of reach and nobody can add to it. A text of only invisible characters counts as empty.
- **For owners:** a friend deletes only their own comments; an owner deletes any, one by one, in the app (Delete on the note). To remove a flood (a leaked link, say), first replace the link (`person relink`), then in the Supabase dashboard's SQL editor run `delete from public.comments where person_id = (select id from public.people where display_name = '<name>');`. `person list` counts the comments a person has now: someone who deleted their own comment counts one less. A memory that loses all its photos in an import takes its comments with it; the import prints how many in its `Removed:` line.
- Tests: `tests/import/comments.test.ts` asks the database directly (a friend's token, another friend's, an owner's, a replaced link, no token) and the second import; `tests/browser/comments.spec.ts` is the phone seam.

## Search

Added with issue 19: `search_memories(p_query, p_at, p_key, p_limit)`, one function, one box in the app (`/search`; the typed words never go in the address).

- **What it finds:** memories (the same rows as the timeline, newest first, a page of at most 100 after a cursor like `timeline_page`) that have every word typed, in a message (a photo's caption too), in a comment, or in the name of a person who sent a photo or a message in it. Different words may be found in different places. The first 8 words, in typed order, are used; the app says so when there are more.
- **Where in a word:** a word matches at the start of a word (the start of the text, or after anything that is not a letter or a digit). "ista" finds "İstanbul"; "ali" does not find "Şeftali". The typed text is plain: `%`, `_`, `\` and the like mean themselves (`private.word_start` escapes every character that is not a letter or a digit).
- **Folding:** `private.fold(text)` is applied to the stored text and to the typed words alike: a letter and a combining mark become one character (NFC), capital letters go, İ, I and ı all become `i`, and ş ğ ü ö ç (â î û) become s g u o c. So `istanbul` finds `İstanbul`, `ISTANBUL` and `ıstanbul`, and `sarki` finds `şarkı`. Other accents are kept (é stays é). It does not depend on the database's locale.
- **Access:** row level security keeps the planner from using an index for a condition that is not leakproof, so a search under the caller's own rights read every message. `private.search_memory_ids` therefore finds the candidates with the owner's rights, using the trigram indexes, and answers only a person with a live session (`current_person_id()`). `search_memories` runs with the caller's rights and checks every candidate again: a memory is returned only if each word is in a message, comment or name the caller's own rules let them read, and the row itself comes from the `timeline` view. A visitor has no right to run it; a session that has ended gets nothing.
- **Speed:** GIN trigram indexes on the folded `messages.text` and `comments.body`, and `messages (person_id, memory_id)` for names. A word needs three letters or digits in a row for the index. Beside such a word a shorter one is only checked on the candidates; alone (or only emoji and punctuation) the memories are walked from the newest and checked, which is quick when the words are common and takes a few seconds on 400,000 messages when they are rare. The app searches such words only on Enter, not on a typing pause.
- **The screen:** the results are the timeline's own pages and cards (`ChunkView`), so only the cards near the screen are held in the page. An older search is cancelled when a newer one starts, and if it answers anyway it changes nothing. Back from a memory returns to the same results at the same place, and the memory's Back button names the list (`from` in the history state).
- The browser test is `tests/browser/search.spec.ts`; `language.spec.ts` walks the screen in both languages.

## Tests

- `pnpm test`: the import seam. The command runs on made-up exports and the result is read from the running local Supabase (database and bucket), so Supabase must be up. Each test uses names of its own.
- `pnpm test:browser`: the app in a phone-size browser against the running local Supabase. One-time browser download: `pnpm exec playwright install chromium`. Data is made by running the real owner commands: sign-in tests first on an empty timeline, then the real import of the made-up exports, then the timeline and memory tests, then the full-timeline tests (two more chats of their own), and last a large made-up archive (2,400 memories, 22 at one moment, two time zones; written at test time) for the scrolling tests. The large archive is removed by a teardown project when all tests that use it have finished. Before it starts, it deletes all chats (with their memories, messages and photos) and the photos in the bucket of the local stack. Never run it against a stack that holds anything you want to keep, and not at the same time as `pnpm test` on the same stack.
- `pnpm check:size`: the size cap on `src/`.
