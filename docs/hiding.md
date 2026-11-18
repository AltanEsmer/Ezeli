# Hiding

A friend asks an owner, privately, to hide something they regret: a message, a photo or a whole memory. The owner hides it with one command. It is then gone for everyone, on every screen, and stays gone after later imports.

**A hidden thing is gone, not flagged.** Its rows and photo files are removed from the database and the bucket, and every import leaves it out. The access rules of the database are the same as before: there is no hiding check on a read, so every screen, view and function (timeline, memory, counts, senders, previous and next, comments) shows it nowhere because it is nowhere.

## The commands

The address is the memory's address in the app: open the memory, copy the address bar (`https://.../m/<key>`, the path `/m/<key>` or just the key all work). The commands need `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the environment, like `import`; without them they print one line saying so.

```
pnpm ezeli memory <address>              # list what the memory holds, each item with a code
pnpm ezeli hide <address> [code] [--yes] # hide one item by its code, or the whole memory
pnpm ezeli hidden                        # apply every mark again, then list what is hidden, each with a code
pnpm ezeli show <code>                   # stop hiding an item of that list
```

A made-up example. A friend says: "the photo of the sunset in the memory from 14 July, and the message where I said we are going on the boat tomorrow".

```
$ pnpm ezeli memory https://ezeli.example/m/3f9c0a1e7b2d4c58a1e60d9b7c4f2a10
Friday, 14 July 2023 (Kaş Tatili)
7d21e0a4  20:50  Karpuz: İskeleye gelin gün batımı çok güzel şarj aletini unutmayın
b4c19f03  20:58  Limon: [Photo]
51aa7e8c  20:59  Fıstık: Çok güzel çıkmış! Işık şahane
e90d3b72  21:10  Karpuz: [Photo]
0c6f48d1  21:25  Limon 🌻: Yarın tekneye gidiyoruz, unutmayın

$ pnpm ezeli hide https://ezeli.example/m/3f9c0a1e7b2d4c58a1e60d9b7c4f2a10 b4c19f03
Hidden: 1 message (1 photo with their files); 0 memories and 0 comments removed with them.
The memory's address is now /m/9d41c27a0be84f6c8a3e5b7d10c2f6aa.

$ pnpm ezeli hide /m/9d41c27a0be84f6c8a3e5b7d10c2f6aa 0c6f48d1
Hidden: 1 message (0 photos with their files); 0 memories and 0 comments removed with them.

$ pnpm ezeli hidden
Kaş Tatili
  2e7b90c5  14 Jul 2023, 20:58  Limon: photo
  a41d03fe  14 Jul 2023, 21:25  Limon 🌻: message

$ pnpm ezeli show a41d03fe
No longer hidden: message by Limon 🌻, 14 Jul 2023, 21:25 (Kaş Tatili). It returns with the next import of that chat.
```

- The listings are printed to your terminal only. Nothing in the app shows them.
- **A code names the item, not its place.** An item's code is the start of its lasting key; a mark's code is the start of its id. A code never changes, so a list that is out of date can never make `hide` or `show` act on the wrong thing, in this chat or another: a code that names nothing is an error.
- Without a code, `hide` hides every photo and message the memory holds now.
- **Hiding a memory's first photo moves its address and its date** to its next photo, as an import would. The old address is no memory any more, to friends and to the commands. A memory with no photo left is removed, **with its comments**; the command counts them, and `show` does not bring them back.
- **`show` is only the removal of a mark.** The thing comes back with the next import of that chat, messages and photos alike, if the export still holds it. Nothing returns at once. (A message used to be shown again without an import; that is no longer so.)
- **When the match is not exact, `hide` lists what else will go with it and waits for a yes.** `--yes` skips the question, for scripts. With no answer nothing is hidden.
- **If a step fails, run `pnpm ezeli hidden`.** The marks are written first, so it applies them again: it removes what is left, removes the files remembered with the marks, and numbers the memories again. It is safe to run any number of times. Running `hide` again with the same code does nothing (the item is gone) and never hides something else.
- **What a friend can still do in between.** The rows go first and the files second. If the files cannot be removed, a friend who already holds a link to a file, or who kept the path (it is in what the memory screen reads), can still open it until `pnpm ezeli hidden` has removed the file. The rule for the bucket lets any signed-in person ask for a link to any file, so "a new link cannot be made" is not true while the file is there.

## What a mark matches

`hide` writes a mark in the table `hidden`: the chat, the person, the clock minute, the kind (photo, message, other media such as a video or voice message, or "media" for Android's "media omitted") and what to match: a photo's hash (made from the bytes of the original file and stored with the photo when it is imported), a message's text, nothing for other media. A mark is applied to what is stored, and to every later export of the chat before it is grouped. One rule, everywhere:

> Among that person's things of that kind in that minute, the ones that match exactly are hidden. If none matches (the file was saved again, the text was edited, the photo has no stored hash, the thing that matched is no longer in the chat), all of that person's things of that kind in that minute are hidden.

It may hide too much. It never hides too little, and it never touches another person's things or another minute.

- **Nothing innocent goes without a line.** `hide` prints what else will go, before it does. Every import prints one line per mark that left out others: who, when, how many other things, and that `pnpm ezeli show <code>` removes the mark, so they come back at the next import if the hidden thing is no longer in the chat.
- Once a mark has matched exactly, it keeps hiding only exact matches among what is already **stored**. But an **export** is judged on its own: if the hidden photo is no longer in the export (the friend deleted it for everyone, or Android only says "media omitted"), a mark with no exact match in the export hides the person's other photos of that minute in that export, and the import says so (see above).
- Photos imported before the hash existed have none: hiding one of them hides all photos of that person in that minute (`hide` prints which). A plain import of the chat adds the hash.
- The two phones name the same message differently: iPhone "video omitted", Android "media omitted" for any media. An Android "media" thing is matched by photo marks and by other-media marks, and a mark made on "media" matches photos and other media. So hiding a video also hides that person's "media omitted" lines of that minute, which may be a photo (the lines say so).
- Texts are matched on the text as stored. A text that mentions a person is stored with that person's name; if the name changes later, the mark no longer matches it exactly, and the other messages of that person in that minute go (with a line).

## What hiding does not do

- A **newer export can add new photos and messages near a hidden memory**, which are not hidden. List the memory again after an import and hide what is new.
- **A link a friend already holds keeps working until the files are removed**, and the files are removed after the rows. On the hosted project a CDN may serve a removed file for a while longer.
- **It can hide too much**: identical texts of one person in one minute are hidden together; the same picture sent twice by one person in one minute is hidden together; a person's other photos of that minute go when a mark cannot be exact. Another person's copy of the same picture, or the same person's in another minute, is not matched.
- **A friend cannot tell it was there from what the database gives**: the rows are gone, the numbering of the messages left has no gaps, and every key is made with a secret of the chat that a friend cannot read, so a key does not give away that something else was sent in the same minute. **What a friend remembers is another matter**: someone who saw the photo, a memory that vanished from the timeline, a gap in the conversation they know of, a memory that kept its internal id while its address and date changed (an import makes a new row instead) can still tell.
- Hiding does not erase the export. A hidden thing stays in the export folders and in the mark (a hidden text is kept in the mark so it can be found again). Delete the export files yourself if a friend asks for that.
- A chat imported under another `--chat` name is a new chat with new secret and keys, and marks do not follow it.
- **A fresh database gets new secrets, so new keys and new addresses, and no marks.** Addresses pasted in the group chat stop working, and every hidden thing comes back with the import. **Back up the table `hidden` and `chats.secret` together** if you ever have to rebuild the database.
- A chat stored before keys had a secret cannot be imported again: the import stops with one line. Remove the chat and import it again. (No real chat exists yet.)
- Grouping is done without the hidden things, so a memory can split or join differently than before, and messages near a hidden photo may now be in another memory or in none.
- **A hide while an import runs is put right by the import** (it runs the same step at its very end), and a hide never removes a file that no row of it points at, so it cannot take the new files of an import that is still running. Still, run one at a time: the numbers an import prints for that run may not be exact. An import clears files that no row points at only at its own end, and only files that were already there when it began; two imports of one chat at once can still remove each other's new files.
- Hiding is by owners only. A friend cannot hide their own things in the app.
- The marks table is a seventh table beside the spec's six (the spec names six; this one holds what the import needs to read).
- Code that runs with its owner's rights (a `security definer` function, such as a search) must never read `hidden`: its column `match` holds the text of what was hidden.

## How it is kept

- Marks live in `hidden` (`supabase/migrations/20261121000000_hiding.sql`), unreadable by signed-in people. Nothing else was added for hiding to the rules of reading, except that signed-in people can no longer read `chats.secret` (the secret every key of the chat is made with) and `photos.content_hash`.
- One step, `applyMarks` (`cli/import/marks.ts`), removes every stored row a mark matches, leaves each touched memory as an import would (its address and date from its first photo left, messages numbered without gaps, a memory with no photo left removed with its comments), and removes the files of the rows it removed. The paths of files still to remove are kept with the mark (`hidden.pending`) until they are gone. `hide`, `hidden` and every import run it; `hide` writes marks first. Every import leaves marked things out before it groups, runs it at its start, and runs it once more at its very end.
- Keys are made before the marked things are left out, so the things that stay keep the keys they have stored.
- Tests: `tests/import/hiding.test.ts` and `tests/browser/hiding.spec.ts`. Two seams exist for tests only: `EZELI_TEST_PAUSE` (an import waits after uploading, so a test can run a hide in the middle) and `EZELI_TEST_FAIL` (`rows` or `files`, a run stops as a failed database or storage would).
