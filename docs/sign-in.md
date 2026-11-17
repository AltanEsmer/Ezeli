# Sign-in and running locally

A friend opens a personal link and is signed in as themselves. No email, no password.

## How it works

- An owner runs `pnpm ezeli person add --name <display name> [--owner]`. It creates one Supabase Auth account for the person and a row in `people`, and prints the link. Display names are unique.
- The link is `https://<app>/#k=<login id>.<secret>`. The part after `#` never leaves the browser. The app signs in with it (the secret is the account's password), removes it from the address bar at once, and keeps the session on that device.
- The account's address is made up (`<login id>@ezeli.invalid`) and no mail is ever sent. Public sign-up is off (`supabase/config.toml`), so the only accounts are the ones the owners create.
- Every access rule asks one question, through `private.current_person_id()`: which person is this request, given that the session still exists? A signed-out device, or one whose link was replaced, reads nothing at once, not when its token runs out.
- Sign-out uses `signOut({ scope: 'local' })`: it ends this device only.
- Labels are in `src/i18n.ts`, English and Turkish, picked from the browser's language.

On the hosted project (not set up yet) the same things are dashboard switches under Authentication: turn off "Allow new users to sign up", leave anonymous sign-ins off, keep the Email provider on, set no custom SMTP and no external providers. Then create one account and check that the hosted admin API accepts the `.invalid` address.

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

## Tests

- `pnpm test`: the import seam.
- `pnpm test:browser`: the app in a phone-size browser against the running local Supabase. One-time browser download: `pnpm exec playwright install chromium`. Data is made by running the real owner command.
- `pnpm check:size`: the size cap on `src/`.
