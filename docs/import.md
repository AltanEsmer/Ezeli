# Import

An owner loads a chat export with one command. It reads a WhatsApp export in the iPhone layout and in the Android layout, and a Discord export made with DiscordChatExporter. It can try the import first (`--trial`, saves nothing) and then save it.

```
pnpm ezeli import <export folder> --people <file> --timezone <zone> --trial
pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat "<chat name>"
```

- `<export folder>`: the unzipped export, with the chat text (`_chat.txt` on an iPhone, the one `.txt` file on Android; with several, the one with "WhatsApp" in its name) and the media files next to it (WhatsApp), or with `messages.json` and a `media` folder (Discord). The kind of export is recognised from the folder's contents; the command is the same.
- `--people <file>`: the people file, described below.
- `--timezone <zone>`: the time zone the memory dates are shown in, such as `Europe/Istanbul`. For WhatsApp it is the zone the phone that made the export was in (exports carry clock times without a zone). A Discord export carries exact times, so for Discord it is only the zone the dates are shown in.
- `--date-order day-first|month-first`: only for a WhatsApp export whose dates cannot say (see below).
- `--chat <name>`: the name of the chat, needed when saving. Importing a later export of the same chat under the same name is the same chat (case and spaces around the name are ignored).
- `--trial`: print the summary and save nothing (no `--chat`, no secret key needed).
- `--details`: also print the conversation of every memory, to check the grouping.

## What is read

**Layouts.** iPhone: `[3.08.2019 09:15:02] Name: text`. Android: `8/3/19, 9:15 AM - Name: text`. A file is in one of the two from top to bottom.

**Dates and times** are read as phones write them: dots, slashes or dashes; two or four digit years, or year first; with or without a comma; 24-hour or 12-hour (`AM`, `PM`, `a.m.`, `p.m.`, Turkish `ÖÖ`/`ÖS` before the time); a dot in the clock; a narrow no-break space before `PM`. 12 AM is hour 0.

**What starts a message.** A line is a header only if it has the header shape and its time is not earlier than the header before it (up to an hour of disorder is allowed). A line a friend typed, such as a plan with dates, therefore stays in the message it was typed in, with or without a name-like part. A line with a date and time but no sender that is no known notice is counted under problems, as it may be typed text that is later than the message before it (typed dates in the future cannot be told from headers).

**Day first or month first is decided once for the export**, never per line: both orders are tried on the header-shaped lines and the one under which fewer lines are impossible or out of time order is used. If they tie (every number is 12 or less, or the dates contradict each other) the run stops and asks for `--date-order`. Between brackets a date that cannot exist (31 February, 25:61) stops the run and names the line; without brackets such a line stays in its message and is counted under problems.

- A line that is not a header continues the message before it. Messages are put in time order.
- A photo is a tag such as `<attached: file>` anywhere in the message (only its shape is matched, as the word may be translated), or Android's `file (file attached)` (`dosya ekli`). It counts as media only when the file name looks like one WhatsApp writes (`00000042-PHOTO-...jpg`, `IMG-20210428-WA0001.jpg`, a hex name) or the file is in the folder; typed text such as `<Not: yarın gelmiyorum>` stays text. A photo whose file is not in the folder is listed under problems, by the sender's display name, and the run goes on.
- Videos, voice messages, GIFs and documents become a placeholder line such as `[Video]`. Stickers and shared locations are skipped.
- Media that is not in the export: the iPhone says what it was (`image omitted`, Turkish `görüntü dahil edilmedi`), so a missing photo is listed under problems. Android only writes `<Media omitted>` (`<Medya dahil edilmedi>`, `<Medya atlanmış>`): that is kept as its own kind, `media`, shown to a friend as "Media (not in the export)".
- Joined, left, added, created and encryption notices are skipped: the iPhone starts each of them with an invisible left-to-right mark, which a written message never has; on Android they have no sender, and a notice with a colon inside (a group renamed to "Kamp: Abant", English and Turkish) is recognised by its whole wording. Deleted-message notices are skipped by their words (English and Turkish). The marker for an edited message is removed from the text.
- Files in the folder that no message mentions are listed under problems. If no photo was read although photo files exist, the summary says so: the export is probably in a layout this reader does not know.

**Believed, not verified**, to be checked against a real export of each layout: Android date shapes other than the English US one, `(dosya ekli)` and the Turkish omitted wordings, the word inside the Turkish iPhone attachment tag (only its shape is matched), the notice wordings, how Android writes a mention of a saved contact (a number or a name), whether the iPhone and Android minutes of the same message agree, whether `~ name` senders appear at all, and the exact spots of the invisible marks.

Not handled: when clocks go back, the repeated hour is read as its second occurrence.

Keep real exports and the people file in `private/` or outside the repo. Neither is ever committed.

## Discord

An owner makes the export with DiscordChatExporter and a bot. Nobody has seen a real export file yet: the reader is built from the tool's documented layout (release 2.48), and stops with a plain message on a file that does not match it. **On the first real export, compare it with the layout below** (see "What to compare on the first real export").

### Making the export (the owner's steps)

The group's Discord chat is a channel in a server. You need the right to add apps to the server (Manage Server). Never use a personal account's token or any tool that automates a personal account: Discord forbids it and the account can be banned. A bot is the allowed way. The token, the application id, the channel id and the server's name never go into this repo, an issue or a chat.

Tell the friends before you export, keep the files private (outside the repo), and take the bot out afterwards.

1. Read Discord's Developer Policy and Developer Terms of Service once (linked from the developer docs under "Policies"). Creating the bot means accepting them.
2. Open the Discord Developer Portal (discord.com/developers/applications), sign in, **New Application**, name it, **Create**.
3. Open **Bot**. Under **Privileged Gateway Intents** switch **Message Content Intent** on. Without it every message comes out empty.
4. On the same page click **Reset Token** and copy the token. It is shown once. Treat it like a password.
5. Switch **Public Bot** off, so nobody else can add it.
6. On **General Information** copy the **Application ID**.
7. Open `https://discord.com/oauth2/authorize?scope=bot&permissions=66560&client_id=<application id>` with your application id, choose the server and confirm. 66560 means only "View Channels" and "Read Message History".
8. If the channel is private, give the bot access to that channel.
9. In Discord: Settings, Advanced, **Developer Mode** on. Right-click the channel, **Copy Channel ID**.
10. Download the command-line build for your computer from release 2.48 of `Tyrrrz/DiscordChatExporter` (`DiscordChatExporter.Cli.osx-arm64.zip` for an Apple-chip Mac) and unzip it. The program is not signed by Apple, so macOS may refuse to open it until you allow it; the tool's guide explains how, and it is your call. There is also a Docker image.
11. In a terminal, in the unzipped folder, with an export folder outside this repo:

    ```
    read -s DISCORD_TOKEN && export DISCORD_TOKEN
    ./DiscordChatExporter.Cli export -c <channel id> -f Json --utc --media --reuse-media \
        -o "<export folder>/messages.json" --media-dir "<export folder>/media/"
    ```

    The first line lets you paste the token without showing it or saving it in the shell history.
12. Check that `messages.json` exists and that `media` holds photos. Then remove the bot from the server and reset the token.

For newer history later, run the same command into the same folder and import it again. Message ids never change, so only what is new is added. If the channel has threads that matter, they are exported as their own files and are not read yet.

### What is read

`messages.json` (UTF-8 JSON, messages oldest first) next to the `media` folder.

- Only real messages: `type` is `Default` or `Reply` and the author is not a bot. Joins, pins, calls and other notices, bot messages, link previews, stickers, reactions and forwarded messages are skipped. A message with no text and no attachment is skipped.
- Times are `timestamp` (written in UTC because of `--utc`; the offset in the text is honoured, and a time without an offset stops the run). Dates are shown in `--timezone`.
- Photos come only from a message's `attachments`, never from listing `media` (which also holds avatars, emoji and link-preview images). A photo is decided by the file extension of `fileName`: jpg, jpeg, png, webp, gif, heic, heif. Each attachment is stored as its own message, with the message's text as the caption of its first photo. An attachment is read from `url`, a path relative to the folder of `messages.json`; if it is still a web address (`https://...`) or the file is not there, the photo is missing media and is listed under problems. A video becomes the placeholder line `[Video]`, a voice message (ogg, opus, mp3, m4a, wav, aac...) `[Voice message]`, any other file `[Document]`.
- Text is the export's own `content`, unchanged, except mentions. The export writes a mention as `@name`; using the export's `mentions` list, a mentioned person from the people file is shown under their Ezeli name, and a mentioned person who is left out or not in the people file is removed from the text, name and all. Custom emoji stay `:name:`.
- An export with no messages from people, or where no message has text or an attachment (usually the bot's Message Content Intent was left off), stops the run and stores nothing. So does a `type` that is a number (Discord's own format).
- Grouping, people matching, saving and the summary are the same as for WhatsApp.

### What to compare on the first real export

- The time in `timestamp`: expected like `2021-03-04T18:22:05.123+00:00`.
- That every message has `id`, `type`, `timestamp`, `content`, `author.id` and `attachments[]` with `id`, `fileName` and `url`.
- That `attachments[].url` is `media/<name>-<16 hex characters>.<ext>`. The reader tries the path as written and with `%20`-style escapes undone, in case the tool escapes file names.
- That `author.id` is the account id (used in the people file) and `author.name` / `author.nickname` the username and server name, and that each `mentions[]` entry has the same shape.
- That `type` is the word (`Default`, `Reply`, ...), and what a forwarded message and a thread starter look like.
- That a photo uploaded from an iPhone (`.heic`) is present; it is converted during the import like any other photo.

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
- `discord`: the same for Discord: the account id, a string of digits that never changes (Discord shows it with Developer Mode on, and the run prints it, with the server name and username, for a sender it does not know). Names are not matched: server names are not unique and change, so an account that is not listed by id stops the run. Those names are printed for you only and never stored. Listing both `whatsapp` and `discord` joins the two into one person.
- `leftOut`: set to `true` for someone whose messages and photos must not be imported, such as a former member. Their `name` is only a label for the owners.

The whole file is checked: a value of the wrong type (such as `"leftOut": "true"`) or an unknown key stops the run.

A sender who is in the export but not in this file stops the run. All unknown senders are listed, so they can be added in one go.

## Saving

Without `--trial` the import saves, with the secret key from the environment (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`), like `person add`. It never runs from the app.

- **Tables:** `chats`, `memories`, `messages`, `photos`. Only messages that belong to a memory are stored. A message that carried a video, voice message, GIF or document is stored with that kind and no text, and shows as a placeholder line. Left-out senders are never stored.
- **People:** each person in the people file who appears in a stored message is matched to a row in `people` by `id`. With no row for that id, a row with the same display name and no id yet (made earlier by `person add`) is adopted. Otherwise a row is created, without an account (`person add --name <display name>` gives it a link later). A changed display name updates the same row; if the new name belongs to someone else the import stops and says so. There is never a second row for one id.
- **A memory's date** is when its first photo was sent, read in `--timezone`. The time zone is kept with the chat and the app shows the date in it. It is **fixed at the chat's first import**: importing the same chat again with another `--timezone` stops with a message and changes nothing.
- **Photos:** each is stored twice in the private bucket `photos` (in a folder named by the chat's id), as WebP: a viewing size (longest side at most 1600 px) and a small one for the timeline (720 px). Photos that are already smaller are not enlarged. The photo's own metadata (such as where it was taken) is dropped. Originals are never uploaded. iPhone HEIC photos are converted first, in a trial run too: the image library's own build cannot read HEIC, so the `heic-decode` package (libheif as WebAssembly, a development dependency used by this command only, not in the app) decodes them once; a file is HEIC by its content, not its name. A photo this build cannot read is listed under problems and is stored as a photo message without a photo; the rest is imported. The colour profile of a HEIC (Display P3) is not carried over.
- **Lasting keys.** A WhatsApp export has no message ids, so each row carries a key made from the chat's content, for the later import of a newer export (issue 13). Every key is made with a secret that belongs to the chat (`chats.secret`, made at the chat's first import, unreadable by signed-in people), so a friend cannot work a key out from what they can read; a chat stored before the secret existed has none and keeps its keys. The time zone, the UTC instant, the display name, the photo's file name and a photo's caption are never part of a key.
  - Discord: the export has Discord's own lasting ids, so no recipe is needed. A message's key is made from the chat's key and its message id, a photo's (also the key of its message) from the chat's key and its attachment id. Edited text, a changed name or a newer export never change a key. A memory's key is that of its first photo, as for WhatsApp.
  - chat: the app and the name, without case and surrounding spaces (`whatsapp:kaş tatili`, `discord:kış sunucusu`);
  - message: hash of chat key, the clock time as written in the export cut to the minute (`2023-07-14 20:58`; an iPhone has seconds and an Android phone has not), the person's `id`, the text, and its position among identical ones in the chat (two "tamam" in the same minute are two messages). The text has its mentions left out, so a mention written as a name (iPhone) or a number (Android) does not make the same message two;
  - media (a photo, and also the key of its message, or any other media): chat, clock minute, person `id`, and its position among that person's media in that minute. Neither the text nor the kind is part of it: an edited caption stays the same photo, and the iPhone's `image omitted` and Android's `<Media omitted>` are the same message. The same chat exported from an iPhone and from an Android phone therefore stores every message once;
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
- In a WhatsApp export an edited message text is a new message (the text is part of the key): the old one is removed and the edited one added. In Discord the key does not change, so the row is updated. An edited photo caption is not (see the photo key). A sender marked `leftOut` later loses their stored messages and photos, files included.
- **Removing photos:** the photo's row goes first, its files after. If the files cannot be removed, the command says so in one line; the next saving run removes the files in the chat's folder of the bucket (`<chat id>/...`) that no row points at. Run one import at a time.
- **Photo files missing from a later export** (such as an export without media) do not remove stored photos: a stored photo keeps its row and moves with its message to the memory the regroup gives it.
- **The summary** of a saving run starts with three lines, each counting memories, messages and photos: `Added:` (new), `Already there:` (stored before, even if moved to another memory or outside this export's time) and `Removed:`. When comments went with a memory that has no photo left, `Removed:` also ends with their number (`, 1 comment`). The lines below describe the export itself.

### What follows a memory that disappears

Comments (issue 18) are the one table that points at memories today. Rule: **rows attached to a memory that disappears move to the memory that now holds its first photo; if that photo is gone, to the memory that now holds the earliest of its remaining photos; only if none of its photos remain do they go with it.** A memory is keyed by its first photo's message, so after saving, that message says which memory holds it now. Moves are not undone: if two memories are joined and later split again, the comments stay on the first.

The step is built in `cli/import/regroup.ts` (`followsMemory`), where `comments.memory_id` is listed. A table that points at memories must be listed there and its column must be `references public.memories (id) on delete restrict`, not cascade: one that is not listed stops the import with a plain line naming the table, instead of silently losing rows (the run can be repeated once it is listed).

Hidden things (see `docs/hiding.md`) are gone, not flagged: the owner command removes them, and the import leaves them out. The saving reads the marks of the chat from the table `hidden` and leaves what they match out of the export's messages before grouping (the keys are worked out first, so what stays keeps its stored key), runs `applyMarks` (`cli/import/marks.ts`) on what is stored before it reads it and once more at its very end, and never keeps an empty memory. Photos store the hash of their original file (`photos.content_hash`); it is made from the file's bytes before the photo is converted.

## What the trial run prints

The number of memories, photos and people, the date range, the problems found (such as photos missing from the export), and one line per memory.

## Phone numbers (WhatsApp)

No phone number is stored or printed, with one exception: the list of senders who are not in the people file.

- A sender who appears as a number (someone the exporting phone has not saved) is matched through the people file. Write the number in `whatsapp` as in the chat; it is matched in full once spaces, dashes and brackets are removed, so list each form the chat uses (`+90 500 000 00 01` and `0500 000 00 01`). Other senders are matched exactly as written, `~ Name` only if the file lists `~ Name`.
- The unknown-sender list is printed exactly as written in the export, a number or a name, because the file cannot be filled in without it. A line above it says it can hold phone numbers and must not be pasted anywhere. No message text is printed there.
- A mention shows `@display name` for a person in the people file. A left-out person, and a number or name that is not in the file, is removed from the text, name and all. An iPhone mention is `@` and a name between invisible marks; an Android one is `@` and digits.
- A number typed in a message is removed when it has 10 to 13 digits once spaces, dashes, dots, brackets and a line break are taken out, with or without a leading `+` or `0`. It stays when it has 9 digits or fewer (dates, times, years), more than 13 digits or letters stuck to it (order and tracking numbers, IBANs), a currency sign or word next to it (amounts), or is a row of years or a date with its year. When in doubt privacy wins: an order number of 10 to 13 digits written plain is removed, and two numbers written with only a space between them stay.
- The problem lists are cleaned in the same way.

## Not handled yet

- Discord: a symbolic link inside the export folder is followed (the exporter never writes one), and forwarded messages and exported threads are not read.
