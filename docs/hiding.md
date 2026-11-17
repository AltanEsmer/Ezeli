# Hiding

A friend asks an owner, privately, to hide something they regret: a message, a photo or a whole memory. The owner hides it with one command. It is then gone for everyone, on every screen, and stays gone after later imports.

## The commands

The address is the memory's address in the app: open the memory, copy the address bar (`https://.../m/<key>`, the path `/m/<key>` or just the key all work). The commands need `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the environment, like `import`.

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
Hidden 1 item; 1 photo removed from the store.

$ pnpm ezeli hide https://ezeli.example/m/3f9c0a1e7b2d4c58a1e60d9b7c4f2a10 1
Hidden 1 item; 0 photos removed from the store.

$ pnpm ezeli show https://ezeli.example/m/3f9c0a1e7b2d4c58a1e60d9b7c4f2a10 1
Shown again: 1 item.
```

- The listing is printed to your terminal only. Nothing in the app shows it or the numbers. A number is the line's place in the memory at the moment you list it; list the memory again before you use a number later, since a regrouping import can change a memory.
- Hidden lines are marked `(hidden)` in the listing. Without a number, `hide` hides every photo and message the memory holds now.
- `show` removes the marks. A hidden **message** is readable again at once, without an import. A hidden **photo**'s files were removed from the store, so `show` only lifts the mark: the photo comes back with the next import of the chat (the export must still hold the photo). `show` says so when it lifts the mark of a photo. A memory whose photos were all hidden is back on the timeline once the import has stored its photos again.
- `show` on a whole memory removes the marks of everything in it, including a message that was hidden on its own earlier.

## What hiding does

- **Marks hang on the things themselves**, not on memories. They live in the table `hidden` (`key` is the lasting key of a photo or a message; a photo's key is also its message's key). The import and a regroup move photos and messages between memories but never change their keys, so a mark cannot be lost and an import cannot bring a hidden thing back: the import never converts or uploads a hidden photo, and a hidden message stays hidden when its row is saved again.
- **The rule is in the database.** A signed-in person's access rules hide a marked message and photo, and any memory with no visible photo. So the tables, the `timeline` view, `memory_detail`, counts, who "sent" a memory, the conversation under a memory (a hidden photo leaves no "Photo" line), the memory before and after, and the bucket all follow, as will every later screen. A memory whose photos are all hidden is on no screen, and its address answers like one that does not exist; its messages cannot be read from the table either. A signed-in person cannot see the `hidden` table or that a mark exists. Tests: `tests/import/hiding.test.ts` and `tests/browser/hiding.spec.ts`.
- **A hidden photo's files (both sizes) are removed from the bucket** and its `photos` row is deleted when you hide it. If the files cannot be removed the command says so; the access rules already refuse them, and the next saving import removes files that no row points at.

## What hiding does not do

- A **newer export can add new photos near a hidden memory**, or messages and photos the owners did not know of. Marks hold only what was hidden: new things are not hidden. List the memory again after an import and hide what is new.
- **Photo links a friend already holds stop working** because the files are gone. This is wanted, but it means a hidden photo cannot be undone by `show` alone.
- A marked thing stays in the owners' own database and in the export folders. Hiding is not erasing: delete the export files yourself if a friend asks for that.
- Hiding is by owners only. A friend cannot hide their own things in the app.
