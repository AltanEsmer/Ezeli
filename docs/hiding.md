# Hiding

A friend asks an owner, privately, to hide something they regret: a message, a photo or a whole memory. The owner hides it with one command. It is then gone for everyone, on every screen, and stays gone after later imports.

A hidden thing is treated as if it was never sent: a friend cannot tell it was there. The import leaves it out before it groups messages into memories, and the commands leave a memory as an import would.

## The commands

The address is the memory's address in the app: open the memory, copy the address bar (`https://.../m/<key>`, the path `/m/<key>` or just the key all work). The commands need `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the environment, like `import`; without them they print one line saying so.

```
pnpm ezeli memory <address>              # list what the memory holds, numbered
pnpm ezeli hide <address> [number]       # hide one item, or the whole memory
pnpm ezeli show <address> [number]       # show it again
```

A made-up example. A friend says: "the photo of the sunset in the memory from 14 July, and the message where I said I was already there".

```
$ pnpm ezeli memory https://ezeli.example/m/3f9c0a1e7b2d4c58a1e60d9b7c4f2a10
Friday, 14 July 2023 (Kaş Tatili)
  1  20:47  Fıstık: Ben geldim bile 😎
  2  20:50  Karpuz: İskeleye gelin gün batımı çok güzel şarj aletini unutmayın
  3  20:58  Limon: [Photo]
  4  20:59  Fıstık: Çok güzel çıkmış! Işık şahane
  5  21:10  Karpuz: [Photo]

$ pnpm ezeli hide https://ezeli.example/m/3f9c0a1e7b2d4c58a1e60d9b7c4f2a10 3
Hidden 1 item; 1 photo row and 2 files removed from the store.
The memory's address is now /m/9d41c27a0be84f6c8a3e5b7d10c2f6aa.

$ pnpm ezeli hide /m/9d41c27a0be84f6c8a3e5b7d10c2f6aa 1
Hidden 1 item; 0 photo rows and 0 files removed from the store.

$ pnpm ezeli show /m/9d41c27a0be84f6c8a3e5b7d10c2f6aa 1
Shown again: 1 item.
```

- The listing is printed to your terminal only. Nothing in the app shows it or the numbers. A number is the line's place in the memory at the moment you list it, hidden lines included (marked `(hidden)`); list the memory again before you use a number later, since a regrouping import can change a memory.
- Without a number, `hide` hides every photo and message the memory holds now.
- **Hiding a memory's first photo moves its address and its date** to its next photo, as an import would. The old address is no memory to a friend. You can still use it in these commands. If every photo of a memory is hidden, the memory is gone.
- `show` removes the marks. A hidden **message** is readable again at once, without an import. A hidden **photo**'s files were removed from the store, so `show` only lifts the mark: the photo comes back with the next import of the chat (the export must still hold it). `show` says so. A memory whose photos were all hidden is back on the timeline once an import has stored its photos again.
- `show` on a whole memory removes the marks of everything in it, including a message that was hidden on its own earlier.
- A photo is hidden whatever the stored message says it is (Android's "media omitted" can sit on a photo that came from an iPhone export). Hiding a photo that has no row (its file was never in the export, or it is already hidden) says so and is not an error.
- If the files cannot be removed, the command says so in one line and exits with an error: the photo is already unreadable. Run the same command again; it finishes the job. It checks the bucket afterwards.
- **Do not hide or show while an import runs.** An import that read the database before the command ran can write the photo's row again from what it read.

## How it is kept

- The rule is in the database (`supabase/migrations/20261118020000_hiding.sql`), as plain checks on a flag, so every table, view and function that reads through the access rules gets it, and so will every later screen. A signed-in person cannot read a hidden message, photo or memory, from a table, the `timeline` view, `memory_detail`, the counts, who "sent" a memory, the memory before and after, comments of a hidden memory, or the bucket. Tests: `tests/import/hiding.test.ts` and `tests/browser/hiding.spec.ts`.
- **A hidden photo's row and both files are removed**; its message is flagged. A hidden message is flagged and its row stays, so `show` can return it.
- The messages left in a memory are numbered without gaps, and counts and sender lists never include hidden things. Comments point at a memory by its id, so they stay with it when its address moves.
- **The table `hidden`** is what lasts: a seventh table beside the spec's six, for what the import needs to read. It remembers every hidden thing by its lasting key and, because a key can change (see below), also by what it is: a photo by a hash of the original file's bytes (stored on the photo when it is imported, so photos imported before this feature are only known by key), a text message by chat, clock minute, sender and text. The import loads these before it groups, and leaves matching things out, whatever their key. A signed-in person cannot read the table.

## What hiding does not do, and what it does too much

- A **newer export can add new photos and messages near a hidden memory**, which are not hidden. List the memory again after an import and hide what is new.
- **Photo links a friend already holds stop working** because the files are gone. This is wanted, but it means a hidden photo cannot be undone by `show` alone. On the hosted project a CDN may serve a removed file for a while longer.
- **A photo with the same bytes is hidden too.** The same picture sent twice (forwarded) is hidden in that chat wherever it is, and an identical text in the same minute from the same person is hidden with it. The import chooses hiding too much over letting something come back.
- **Keys can shift.** A message's key is its position among identical ones in its minute; if an earlier message of that minute goes away (a friend deletes it for everyone), later ones take its key. That is why photos and text messages are also matched by what they are. A video or voice message (hidden by key only) can come back in that case.
- **A hidden photo no longer shapes the grouping.** Memories are grouped without it, so a memory can split or join differently than before, and messages near it may now belong to another memory.
- A chat imported under another `--chat` name is a new chat with new keys: marks do not follow it.
- A marked thing stays in the owners' own database (a hidden message) and in the export folders. Hiding is not erasing: delete the export files yourself if a friend asks for that.
- Hiding is by owners only. A friend cannot hide their own things in the app.
