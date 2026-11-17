# Sign-in and running locally

A friend opens a personal link and is signed in as themselves. No email, no password.

## How it works

- An owner runs `pnpm ezeli person add --name <display name> [--owner]`. It creates one Supabase Auth account for the person and a row in `people`, and prints the link. Display names are unique.
- `pnpm ezeli person relink --name <display name>` replaces a lost or leaked link: a new login id and a new secret in one admin call. The old link stops working, and Supabase ends every session of that person, so each of their devices shows the private page on its next load and needs the new link. The person and their comments stay the same.
- `pnpm ezeli person list` shows everyone, whether they have a link, whether they are an owner, and when they last opened their link. That time is `last_sign_in_at`, which Auth already keeps: nothing is tracked by us. Auth keeps only the latest sign-in, so it is the last opening, not the first. Auth's audit log could hold the first, but the secret key cannot read it through the API (it needs direct database access, which owner commands do not have). A sign-in from before a link was replaced does not count: the person shows "not yet" until they open the new link.
- The link is `https://<app>/#k=<login id>.<secret>`. The part after `#` never leaves the browser. The app signs in with it (the secret is the account's password), removes it from the address bar at once, and keeps the session on that device.
- The account's address is made up (`<login id>@ezeli.invalid`) and no mail is ever sent. Public sign-up is off (`supabase/config.toml`), so the only accounts are the ones the owners create.
- Every access rule asks one question, through `private.current_person_id()`: which person is this request, given that the session still exists? A signed-out device, or one whose link was replaced, reads nothing at once, not when its token runs out.
- Sign-out uses `signOut({ scope: 'local' })`: it ends this device only.
- Labels are in `src/i18n.ts`, English and Turkish, picked from the browser's language.

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
- The bucket `photos` is private. A person with a live session can read objects, which is what lets the app ask for signed links (`createSignedUrls`, valid for an hour). Nobody can upload or remove from the app, and a visitor cannot list, download or sign.
- A new table or bucket needs the same three things: row level security on, rights revoked then `select` granted, and a policy through `current_person_id()`. The tests in `tests/import/access.test.ts` show what to check.

## Tests

- `pnpm test`: the import seam. The command runs on made-up exports and the result is read from the running local Supabase (database and bucket), so Supabase must be up. Each test uses names of its own.
- `pnpm test:browser`: the app in a phone-size browser against the running local Supabase. One-time browser download: `pnpm exec playwright install chromium`. Data is made by running the real owner commands: sign-in tests first on an empty timeline, then the real import of two made-up exports, then the timeline tests. Before it starts, it deletes all chats (with their memories, messages and photos) and the photos in the bucket of the local stack. Never run it against a stack that holds anything you want to keep, and not at the same time as `pnpm test` on the same stack.
- `pnpm check:size`: the size cap on `src/`.
