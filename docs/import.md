# Import

An owner loads a chat export with one command. So far it reads a WhatsApp export in the iPhone layout and only does a trial run: it prints what would be imported and saves nothing.

```
pnpm ezeli import <export folder> --people <file> --timezone <zone> --trial
```

- `<export folder>`: the unzipped export, with `_chat.txt` and the media files next to it.
- `--people <file>`: the people file, described below.
- `--timezone <zone>`: the time zone the phone that made the export was in, such as `Europe/Istanbul`. Exports carry clock times without a zone.
- `--trial`: print the summary and save nothing. Without it the command stops, because saving is not built yet.
- `--details`: also print the conversation of every memory, to check the grouping.

## What is read

The iPhone layout: lines such as `[14.07.2023, 20:58:11] Name: text`, day first, with dots or slashes. Android layouts and other date formats are issue 12.

- A line that does not start like that continues the message before it.
- A photo is `<attached: file>` (or the older `file (file attached)`). A photo whose file is not in the folder is listed under problems and the run goes on.
- Videos, voice messages, GIFs and documents become a placeholder line such as `[Video]`. Stickers are skipped.
- Joined, left, added, created and encryption notices are skipped: the iPhone starts each of them with an invisible left-to-right mark, which a written message never has. Deleted-message notices are skipped by their words (English and Turkish). The made-up exports are modelled on this and not yet checked against a real export.

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
    { "name": "Deniz", "whatsapp": ["Deniz Arslan"] },
    { "name": "Elif", "whatsapp": ["Elif Kara", "Elif 🌻"], "discord": ["elif.kara"] },
    { "name": "Tolga", "whatsapp": ["Tolga Eski"], "leftOut": true }
  ]
}
```

- `name`: the display name friends see. Each name appears once.
- `whatsapp`: every sender name the person appears under in the WhatsApp exports, written as in the export. A person who changed their name has several.
- `discord`: the same for Discord. Listing both joins the two into one person.
- `leftOut`: set to `true` for someone whose messages and photos must not be imported, such as a former member. Their `name` is only a label for the owners.

A sender who is in the export but not in this file stops the run. All unknown senders are listed, so they can be added in one go.

## What the trial run prints

The number of memories, photos and people, the date range, the problems found (such as photos missing from the export), and one line per memory.
