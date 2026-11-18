# Hiding

A friend asks an owner, privately, to hide something they regret: a message, a photo or a whole memory. The owner hides it with one command. It is then gone for everyone, on every screen, and stays gone after later imports.

**A hidden thing is gone, not flagged.** Its rows and photo files are removed from the database and the bucket, and every import leaves it out. The access rules of the database are the same as before: there is no hiding check on a read, so every screen, view and function (timeline, memory, counts, senders, previous and next, comments, the bucket) shows it nowhere because it is nowhere.

## The commands

The address is the memory's address in the app: open the memory, copy the address bar (`https://.../m/<key>`, the path `/m/<key>` or just the key all work). The commands need `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the environment, like `import`; without them they print one line saying so.

```
pnpm ezeli memory <address>              # list what the memory holds, numbered
pnpm ezeli hide <address> [number]       # hide one item, or the whole memory
pnpm ezeli hidden                        # list what is hidden, numbered, per chat
pnpm ezeli show <number>                 # stop hiding an item of that list
```

A made-up example. A friend says: "the photo of the sunset in the memory from 14 July, and the message where I said we are going on the boat tomorrow".

```
$ pnpm ezeli memory https://ezeli.example/m/3f9c0a1e7b2d4c58a1e60d9b7c4f2a10
Friday, 14 July 2023 (Kaş Tatili)
  1  20:50  Karpuz: İskeleye gelin gün batımı çok güzel şarj aletini unutmayın
  2  20:58  Limon: [Photo]
  3  20:59  Fıstık: Çok güzel çıkmış! Işık şahane
  4  21:10  Karpuz: [Photo]
  5  21:25  Limon 🌻: Yarın tekneye gidiyoruz, unutmayın

$ pnpm ezeli hide https://ezeli.example/m/3f9c0a1e7b2d4c58a1e60d9b7c4f2a10 2
Hidden: 1 message (1 photo with their files); 0 memories and 0 comments removed with them.
The memory's address is now /m/9d41c27a0be84f6c8a3e5b7d10c2f6aa.

$ pnpm ezeli hide /m/9d41c27a0be84f6c8a3e5b7d10c2f6aa 4
Hidden: 1 message (0 photos with their files); 0 memories and 0 comments removed with them.

$ pnpm ezeli hidden
Kaş Tatili
  1  14 Jul 2023, 20:58  Limon: photo
  2  14 Jul 2023, 21:25  Limon 🌻: message

$ pnpm ezeli show 2
No longer hidden: message by Limon, 14 Jul 2023, 21:25 (Kaş Tatili). It returns with the next import of that chat.
```

- The listings are printed to your terminal only. Nothing in the app shows them or the numbers. A number in `memory` is the line's place in the memory at the moment you list it; list again before you use a number later, since an import can change a memory. A number in `hidden` is the line's place in that list.
- Without a number, `hide` hides every photo and message the memory holds now.
- **When the match is not exact, `hide` first prints what else will go with it** (see "What a mark matches").
- **Hiding a memory's first photo moves its address and its date** to its next photo, as an import would. The old address is no memory any more, to friends and to the commands. A memory with no photo left is removed, with its comments; the command counts them.
- **`show` is only the removal of a mark.** The thing comes back with the next import of that chat, messages and photos alike, if the export still holds it. Nothing returns at once. (A message used to be shown again without an import; that is no longer so.) `show` says so.
- If the files cannot be removed, the rows are already gone. The command says so in one plain line and exits with an error. Run the same command again: it removes the files that have no row, once they are older than a minute (a file uploaded just now may belong to an import that is still running and has not written its row yet). **Until the files are gone, a link a friend already holds keeps working.** A new link cannot be made, since nothing in the database points at the file.
- **Better not to hide while an import runs.** If you do, the import puts it right at its very end. The one thing it cannot undo: the hide may count things the import is about to write, so the numbers it prints for that run are not exact.

## What a mark matches

`hide` writes a mark in the table `hidden`: the chat, the person, the clock minute, the kind (photo, text, other media such as a video or voice message) and what to match: a photo's hash (made from the bytes of the original file and stored with the photo when it is imported), a message's text, nothing for other media. A mark is applied to what is stored, and to every later export of the chat before it is grouped. One rule, everywhere:

> Among that person's things of that kind in that minute, the ones that match exactly are hidden. If none matches (the file was saved again, the text was edited, the photo has no stored hash, the key moved), all of that person's things of that kind in that minute are hidden.

It may hide too much. It never hides too little, and it never touches another person's things or another minute. Once a mark has matched exactly it keeps hiding only exact matches among what is already stored, so a different photo of that minute is not lost when the exact one is gone. Photos imported before the hash existed have none: hiding one of them hides all photos of that person in that minute (`hide` prints which). A plain import of the chat adds the hash, so import again first when that matters.

## What hiding does not do

- A **newer export can add new photos and messages near a hidden memory**, which are not hidden. List the memory again after an import and hide what is new.
- **A link a friend already holds keeps working until the files are removed**, and the files are removed after the rows (see above). On the hosted project a CDN may serve a removed file for a while longer.
- **It can hide too much**: the same picture sent twice (forwarded) is hidden wherever it is; identical texts of one person in one minute are hidden together; when a photo is hidden by a mark that cannot be exact, so are the person's other photos of that minute; a re-saved copy of a hidden photo makes the person's other photos of that minute in that export go too.
- **A friend cannot tell it was there from what the database gives**: the rows are gone, and the numbering of the messages left has no gaps. The keys of messages, photos and memories are made with a secret of the chat that a friend cannot read, so a key does not give away that something else was sent in the same minute, and a memory's address and date come from its first photo that is left. **What a friend remembers is another matter**: someone who saw the photo, a memory that vanished from the timeline, or a gap in the conversation they know of can still tell. Chats imported before the secret existed keep their old keys, which a friend could work out.
- Hiding does not erase the export. A hidden thing stays in the export folders and in the mark (a hidden text is kept in the mark so it can be found again). Delete the export files yourself if a friend asks for that.
- A chat imported under another `--chat` name is a new chat with new keys, and marks do not follow it.
- Grouping is done without the hidden things, so a memory can split or join differently than before, and messages near a hidden photo may now be in another memory or in none.
- Hiding is by owners only. A friend cannot hide their own things in the app.
- An import that stops because of an error leaves marks as they are; running it again finishes the job.
- The marks table is a seventh table beside the spec's six (the spec names six; this one holds what the import needs to read).

## How it is kept

- Marks live in `hidden` (`supabase/migrations/20261118020000_hiding.sql`), unreadable by signed-in people. Nothing else was added for hiding to the rules of reading, except that signed-in people can no longer read `chats.secret` (the secret every key of the chat is made with) and `photos.content_hash`.
- One step, `applyMarks` (`cli/import/marks.ts`), removes every stored row and photo file a mark matches, then leaves each touched memory as an import would (its address and date from its first photo left, messages numbered without gaps, a memory with no photo left removed with its comments), then removes files that have no row. `hide` writes marks and runs it. Every import leaves marked things out before it groups, runs it at its start, and runs it once more at its very end, so a hide that lands while it runs is put right by the import itself.
- Keys are made before the marked things are left out, so the things that stay keep the keys they have stored.
- Tests: `tests/import/hiding.test.ts` and `tests/browser/hiding.spec.ts`.
