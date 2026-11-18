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
- `timeline`: a view (`security_invoker`, so the rules above apply to it) of memories newest first with their first three photos, the photo count and the senders, in one request. The timeline reads it and orders by `at`.
- Signed links are only as short as the app asks for (an hour in `src/memories.ts`). A signed-in person can ask the server for a much longer link to one file; the server does not enforce the short life. A person can download every file anyway, so this is not worse, but it is a choice of the app, not a rule of the server.
- Hiding (`docs/hiding.md`): the policies on `messages`, `photos` and `memories` also refuse a row flagged `hidden`, a plain column check with no function call per row. The flags are set only by the owners' command (secret key). `hidden` (the marks) has no rights for `authenticated`. The `timeline` view, `memory_detail`, comments and the bucket follow, as they read through these rules. A new table that points at memories asks `exists (select 1 from public.memories m where m.id = ...)`, as comments do.
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

## Tests

- `pnpm test`: the import seam. The command runs on made-up exports and the result is read from the running local Supabase (database and bucket), so Supabase must be up. Each test uses names of its own.
- `pnpm test:browser`: the app in a phone-size browser against the running local Supabase. One-time browser download: `pnpm exec playwright install chromium`. Data is made by running the real owner commands: sign-in tests first on an empty timeline, then the real import of two made-up exports, then the timeline tests. Before it starts, it deletes all chats (with their memories, messages and photos) and the photos in the bucket of the local stack. Never run it against a stack that holds anything you want to keep, and not at the same time as `pnpm test` on the same stack.
- `pnpm check:size`: the size cap on `src/`.
