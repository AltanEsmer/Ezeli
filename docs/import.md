# Import

An owner loads a chat export with one command. It reads a WhatsApp export in the iPhone layout and in the Android layout. It can try the import first (`--trial`, saves nothing) and then save it.

```
pnpm ezeli import <export folder> --people <file> --timezone <zone> --trial
pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat "<chat name>"
```

- `<export folder>`: the unzipped export, with the chat text and the media files next to it. The chat text is `_chat.txt` (iPhone) or the one `.txt` file (Android; with several, the one with "WhatsApp" in its name).
- `--date-order day-first|month-first`: only needed when the dates cannot say (see below).
- `--people <file>`: the people file, described below.
- `--timezone <zone>`: the time zone the phone that made the export was in, such as `Europe/Istanbul`. Exports carry clock times without a zone.
- `--chat <name>`: the name of the chat, needed when saving. Importing a later export of the same chat under the same name is the same chat (case and spaces around the name are ignored).
- `--trial`: print the summary and save nothing (no `--chat`, no secret key needed).
- `--details`: also print the conversation of every memory, to check the grouping.

## What is read

**Layouts.** iPhone: `[3.08.2019 09:15:02] Name: text`. Android: `8/3/19, 9:15 AM - Name: text`. A file is in one of the two from top to bottom.

**Dates and times** are read as phones write them: dots, slashes or dashes; two or four digit years, or year first; with or without a comma; 24-hour or 12-hour (`AM`, `PM`, `a.m.`, `p.m.`, Turkish `ÖÖ`/`ÖS` before the time); a dot in the clock; a narrow no-break space before `PM`. 12 AM is hour 0.

**Day first or month first is decided once for the whole export**, never per line: any date whose first number is above 12 shows day first, any whose second is above 12 shows month first. If no date decides it (every number is 12 or less) the run stops and asks for `--date-order`. Dates that show both orders stop the run. A date that cannot exist in the order (31 February, 25:61) stops the run and names the line.

- A line that does not start like that continues the message before it. Messages are put in time order.
- A photo is a tag such as `<attached: file>` anywhere in the message (only its shape is matched, as the word may be translated), or the older `file (file attached)`. A photo whose file is not in the folder is listed under problems, by the sender's display name, and the run goes on.
- Videos, voice messages, GIFs and documents become a placeholder line such as `[Video]`. Stickers are skipped.
- Joined, left, added, created and encryption notices are skipped: the iPhone starts each of them with an invisible left-to-right mark, which a written message never has; on Android they have no sender, and a notice with a colon inside (a group renamed to "Kamp: Abant") is recognised by its words. Deleted-message notices are skipped by their words (English and Turkish). The marker for an edited message is removed from the text. Shared locations are skipped.
- Media that is not in the export: the iPhone says what it was (`image omitted`, Turkish `görüntü dahil edilmedi`, and so on), so a missing photo is listed under problems. Android only writes `<Media omitted>` (Turkish `<Medya dahil edilmedi>`, `<Medya atlanmış>`), so it cannot be known what it was: it is kept as a `[Document]` placeholder, never as a photo.
- An Android file name starts `IMG-`, `VID-`, `PTT-`, `AUD-` or `STK-`, which tells photo, video, voice, audio and sticker apart, like the iPhone's `-PHOTO-` and so on.

**Which words and shapes are believed, not verified**, and to be checked against a real export of each layout: the Android date shapes other than the English US one, `(dosya ekli)` and the Turkish omitted words, the word inside the Turkish iPhone attachment tag (only its shape is matched), the `~ name` sender of newer iPhones, and the exact spots of the invisible marks.
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
- **Photos:** each is stored twice in the private bucket `photos`, as WebP: a viewing size (longest side at most 1600 px) and a small one for the timeline (720 px). Photos that are already smaller are not enlarged. The photo's own metadata (such as where it was taken) is dropped. Originals are never uploaded. iPhone photos in HEIC format are converted first (with the `heic-decode` package: the image library's own build cannot read HEIC), in a trial run too. A photo this build cannot read is listed under problems and is stored as a photo message without a photo; the rest is imported.
- **Lasting keys.** An export has no message ids, so each row carries a key made from the chat's content, for the later import of a newer export (issue 13) and for hiding (issue 20). The time zone, the UTC instant, the display name, the photo's file name and a photo's caption are never part of a key.
  - chat: the app and the name, without case and surrounding spaces (`whatsapp:kaş tatili`);
  - message: hash of chat key, the clock time as written in the export cut to the minute (`2023-07-14 20:58`; an iPhone has seconds and an Android phone has not, so the same chat exported from both gives the same keys and importing both stores nothing twice), the person's `id`, the kind of media (empty for text), the text, and its position among identical ones in the chat (two "tamam" in the same minute are two messages);
  - photo (also the key of its message): the same, but without the text: chat, clock minute, person `id`, and its position among that person's photos in that minute, so an edited caption stays the same photo;
  - memory: the key of its first photo **message**, whether or not that photo's file is in the export or can be read. A photo message without a readable file still counts for grouping and for the key; only its files and its `photos` row are missing, and a later import that has the file adds them to the same memory.
- A memory with no stored photo is not shown on the timeline. A `photos` row exists only when both of its files are in the bucket.
- If saving fails (the bucket or the database), the command prints one plain line and exits with an error. Files go first and rows are written by key, so running the same import again finishes the job.
- Saving is by key, so saving the same export twice leaves one copy. Making a second import correct (new grouping, hidden marks, comments) is issues 13 and 20.

## What the trial run prints

The number of memories, photos and people, the date range, the problems found (such as photos missing from the export), and one line per memory.

## Phone numbers

No phone number is stored or printed.

- A sender who appears as a number (a person the exporting phone has not saved) is matched through the people file: write the number in `whatsapp` as it is in the chat. Spaces, `+`, brackets and the country code are ignored (the last ten digits are compared), and a newer iPhone's `~ name` matches `name`. A number that is not in the file stops the run, and is named only by its first message ("a phone number (first message 2019-08-03 21:17)").
- A mention of a number (`@905000000002`) becomes `@` and that person's display name, or is removed when the number is not in the file. An iPhone mention (`@Name` between invisible marks) becomes `@` and the display name when the name is a known sender.
- A number typed inside a message is removed: `+` with 8 to 15 digits, Turkish mobile numbers (`0532 000 00 00`), three-three-four numbers (`212-555-0101`), or 11 to 15 digits in a row. Dates, times, prices and years are not touched. Problem lists are cleaned the same way.

## Not handled yet

- A newer export that changes grouping can leave an older memory behind (issue 13).
