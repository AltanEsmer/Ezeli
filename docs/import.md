# Import

An owner loads a chat export with one command. So far it reads a WhatsApp export in the iPhone layout. It can try the import first (`--trial`, saves nothing) and then save it.

```
pnpm ezeli import <export folder> --people <file> --timezone <zone> --trial
pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat "<chat name>"
```

- `<export folder>`: the unzipped export, with `_chat.txt` and the media files next to it.
- `--people <file>`: the people file, described below.
- `--timezone <zone>`: the time zone the phone that made the export was in, such as `Europe/Istanbul`. Exports carry clock times without a zone.
- `--chat <name>`: the name of the chat, needed when saving. Importing a later export of the same chat under the same name is the same chat (case and spaces around the name are ignored).
- `--trial`: print the summary and save nothing (no `--chat`, no secret key needed).
- `--details`: also print the conversation of every memory, to check the grouping.

## What is read

The iPhone layout: lines such as `[14.07.2023, 20:58:11] Name: text`, day first, with dots or slashes. A date or time that cannot exist (month 14, 31 February, 25:61) stops the run and names the line; this also catches month-first exports. Android layouts and other date formats are issue 12.

- A line that does not start like that continues the message before it. Messages are put in time order.
- A photo is a tag such as `<attached: file>` anywhere in the message (only its shape is matched, as the word may be translated), or the older `file (file attached)`. A photo whose file is not in the folder is listed under problems, by the sender's display name, and the run goes on.
- Videos, voice messages, GIFs and documents become a placeholder line such as `[Video]`. Stickers are skipped.
- Joined, left, added, created and encryption notices are skipped: the iPhone starts each of them with an invisible left-to-right mark, which a written message never has. Deleted-message notices are skipped by their words (English and Turkish). The marker for an edited message is removed from the text.
- Files in the folder that no message mentions are listed under problems. If no photo was read although photo files exist, the summary says so: the export is probably in a layout this reader does not know.

Not handled: when clocks go back, the repeated hour is read as its second occurrence.

Keep real exports and the people file in `private/` or outside the repo. Neither is ever committed.

## Grouping numbers

How photos and messages become memories is set by four numbers. Change them on the command line, not in code.

| Option | Starting value | Meaning |
| --- | --- | --- |
| `--photo-gap <minutes>` | 30 | Photos belong to one memory when the gap to the next photo is under this, also across senders. |
| `--before <minutes>` | 15 | A memory takes the messages sent up to this long before its first photo. |
| `--after <minutes>` | 30 | A memory takes the messages sent up to this long after its last photo. |
| `--max-messages <number>` | 30 | At most this many messages are taken on each side. |

A message belongs to one memory at most. Where two memories are close, the later memory's messages before its first photo are its own, and the earlier memory stops there.

## The people file

A JSON file with one entry per person who ever sent something in the chats. A made-up example:

```json
{
  "people": [
    { "id": "karpuz", "name": "Karpuz", "whatsapp": ["Karpuz K"] },
    { "id": "limon", "name": "Limon", "whatsapp": ["Limon L", "Limon 🌻"], "discord": ["limon.l"] },
    { "id": "cilek", "name": "Çilek", "whatsapp": ["Çilek Ç"], "leftOut": true }
  ]
}
```

- `id`: required. A short lowercase word (letters a to z, digits, `-`) that you pick once for this person and **never change**. It is unique. Lasting keys and the saved person are made from it, so a person keeps their memories, photos and hidden marks when their display name or sender names change. It is stored as `people.slug`.
- `name`: the display name friends see. Each name appears once. It may change later: the next import renames the person.
- `whatsapp`: every sender name the person appears under in the WhatsApp exports, written as in the export. A person who changed their name has several.
- `discord`: the same for Discord. Listing both joins the two into one person.
- `leftOut`: set to `true` for someone whose messages and photos must not be imported, such as a former member. Their `name` is only a label for the owners.

The whole file is checked: a value of the wrong type (such as `"leftOut": "true"`) or an unknown key stops the run.

A sender who is in the export but not in this file stops the run. All unknown senders are listed, so they can be added in one go.

## Saving

Without `--trial` the import saves, with the secret key from the environment (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`), like `person add`. It never runs from the app.

- **Tables:** `chats`, `memories`, `messages`, `photos`. Only messages that belong to a memory are stored. A message that carried a video, voice message, GIF or document is stored with that kind and no text, and shows as a placeholder line. Left-out senders are never stored.
- **People:** each person in the people file who appears in a stored message is matched to a row in `people` by `id`. With no row for that id, a row with the same display name and no id yet (made earlier by `person add`) is adopted. Otherwise a row is created, without an account (`person add --name <display name>` gives it a link later). A changed display name updates the same row; if the new name belongs to someone else the import stops and says so. There is never a second row for one id.
- **A memory's date** is when its first photo was sent, read in `--timezone`. The time zone is kept with the chat and the app shows the date in it. It is **fixed at the chat's first import**: importing the same chat again with another `--timezone` stops with a message and changes nothing.
- **Photos:** each is stored twice in the private bucket `photos` (in a folder named by the chat's id), as WebP: a viewing size (longest side at most 1600 px) and a small one for the timeline (720 px). Photos that are already smaller are not enlarged. The photo's own metadata (such as where it was taken) is dropped. Originals are never uploaded. A photo this build cannot read, such as an iPhone HEIC photo (issue 12), is listed under problems and is stored as a photo message without a photo; the rest is imported.
- **Lasting keys.** An export has no message ids, so each row carries a key made from the chat's content, for the later import of a newer export (issue 13) and for hiding (issue 20). The time zone, the UTC instant, the display name, the photo's file name and a photo's caption are never part of a key.
  - chat: the app and the name, without case and surrounding spaces (`whatsapp:kaş tatili`);
  - message: hash of chat key, the clock time as written in the export cut to the minute (`2023-07-14 20:58`), the person's `id`, the kind of media (empty for text), the text, and its position among identical ones in the chat (two "tamam" in the same minute are two messages);
  - photo (also the key of its message): the same, but without the text: chat, clock minute, person `id`, and its position among that person's photos in that minute, so an edited caption stays the same photo;
  - memory: the key of its first photo **message**, whether or not that photo's file is in the export or can be read. A photo message without a readable file still counts for grouping and for the key; only its files and its `photos` row are missing, and a later import that has the file adds them to the same memory.
- A memory with no stored photo is not shown on the timeline. A `photos` row exists only when both of its files are in the bucket.
- If saving fails (the bucket or the database), the command prints one plain line and exits with an error. Files go first and rows are written by key, so running the same import again finishes the job. When photos are removed it is the other way round: rows first, files after.
- Saving is by key, so saving the same export twice leaves one copy. What importing again does with a newer export, other grouping numbers and what people added is under "Importing again".

## Importing again

Import a newer export of the chat, or the same one with other grouping numbers, with the same command and the same `--chat` name.

- **Same export twice:** nothing changes.
- **A newer export:** only the new memories, messages and photos are added. The last memory of the older export may grow when the newer export continues it; it is the same memory, because its first photo is the same. Photo files already stored are not converted or uploaded again.
- **Other grouping numbers:** the memories are regrouped. A photo is never doubled: it keeps its row and moves to the memory it now belongs to. Messages that no longer belong to any memory are removed (only messages inside memories are stored). A memory whose first photo now belongs to another memory disappears.
- **The rule at the edges:** inside the time an export covers (its first to its last message), the export is the truth; outside it, what is stored is the truth. Before grouping, the export's messages are joined with the stored messages outside that time, and the joined list is grouped. So an export that starts or ends in the middle of a memory, or between its photos, leaves that memory whole; a middle slice or an older export imported after a newer one removes nothing. A stored message is removed only when it lies inside the export's time and the export no longer holds it (an edited text, a sender marked `leftOut` since), or when the regroup leaves it in no memory.
- **Only messages inside memories were ever stored.** A regroup with larger numbers (a longer window before or after the photos) can only use what is stored. For the full effect, import the full export.
- An edited message text is a new message (the text is part of the key): the old one is removed and the edited one added. An edited photo caption is not (see the photo key). A sender marked `leftOut` later loses their stored messages and photos, files included.
- **Removing photos:** the photo's row goes first, its files after. If the files cannot be removed, the command says so in one line; the next saving run removes the files in the chat's folder of the bucket (`<chat id>/...`) that no row points at. Run one import at a time.
- **Photo files missing from a later export** (such as an export without media) do not remove stored photos: a stored photo keeps its row and moves with its message to the memory the regroup gives it.
- **The summary** of a saving run starts with three lines, each counting memories, messages and photos: `Added:` (new), `Already there:` (stored before, even if moved to another memory or outside this export's time) and `Removed:`. The lines below describe the export itself.

### What follows a memory that disappears

Comments (issue 18) do not exist yet. Rule: **rows attached to a memory that disappears move to the memory that now holds its first photo; if that photo is gone, to the memory that now holds the earliest of its remaining photos; only if none of its photos remain do they go with it.** A memory is keyed by its first photo's message, so after saving, that message says which memory holds it now. Moves are not undone: if two memories are joined and later split again, the comments stay on the first.

The step is built in `cli/import/regroup.ts` (`followsMemory`). The comments ticket adds one line: `{ table: 'comments', column: 'memory_id' }`. Its column must be `references public.memories (id) on delete restrict`, not cascade: a table that points at memories and is not listed then stops the import with a plain line naming the table, instead of silently losing rows (the run can be repeated once it is listed).

Hidden marks (issue 20) do not point at memories. That ticket marks photos and messages by their lasting keys, so the regroup owes them nothing. It still has to make sure the saving does not bring a hidden photo or message back (neither upload the photo's files again nor upsert the message as visible).

## What the trial run prints

The number of memories, photos and people, the date range, the problems found (such as photos missing from the export), and one line per memory.

## Not handled yet

- Phone numbers inside message text are stored as written (issue 12). Do not import real chats into a shared stack before that.
