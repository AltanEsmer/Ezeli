# Import

An owner loads a chat export with one command. It reads a WhatsApp export in the iPhone layout and a Discord export made with DiscordChatExporter. It can try the import first (`--trial`, saves nothing) and then save it.

```
pnpm ezeli import <export folder> --people <file> --timezone <zone> --trial
pnpm ezeli import <export folder> --people <file> --timezone <zone> --chat "<chat name>"
```

- `<export folder>`: the unzipped export, with `_chat.txt` and the media files next to it (WhatsApp), or with `messages.json` and a `media` folder (Discord). The kind of export is recognised from the folder's contents; the command is the same.
- `--people <file>`: the people file, described below.
- `--timezone <zone>`: the time zone the memory dates are shown in, such as `Europe/Istanbul`. For WhatsApp it is the zone the phone that made the export was in (exports carry clock times without a zone). A Discord export carries exact times, so for Discord it is only the zone the dates are shown in.
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
- Text is the export's own `content`, unchanged (mentions are already written as `@name`, custom emoji as `:name:`).
- Grouping, people matching, saving and the summary are the same as for WhatsApp.

### What to compare on the first real export

- The time in `timestamp`: expected like `2021-03-04T18:22:05.123+00:00`.
- That every message has `id`, `type`, `timestamp`, `content`, `author.id` and `attachments[]` with `id`, `fileName` and `url`.
- That `attachments[].url` is `media/<name>-<16 hex characters>.<ext>`. The reader tries the path as written and with `%20`-style escapes undone, in case the tool escapes file names.
- That `author.id` is the account id and `author.name` the username, to fill the people file.
- That `type` is the word (`Default`, `Reply`, ...), and what a forwarded message and a thread starter look like.
- That a photo uploaded from an iPhone (`.heic`) is present; this build cannot read HEIC yet (issue 12), so it is listed under problems.

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
- `discord`: the same for Discord: an account id (best: it never changes; Discord shows it with Developer Mode on, and the trial run prints it for a sender it does not know) or a name (the username, or the name shown in the server). Listing both `whatsapp` and `discord` joins the two into one person.
- `leftOut`: set to `true` for someone whose messages and photos must not be imported, such as a former member. Their `name` is only a label for the owners.

The whole file is checked: a value of the wrong type (such as `"leftOut": "true"`) or an unknown key stops the run.

A sender who is in the export but not in this file stops the run. All unknown senders are listed, so they can be added in one go.

## Saving

Without `--trial` the import saves, with the secret key from the environment (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`), like `person add`. It never runs from the app.

- **Tables:** `chats`, `memories`, `messages`, `photos`. Only messages that belong to a memory are stored. A message that carried a video, voice message, GIF or document is stored with that kind and no text, and shows as a placeholder line. Left-out senders are never stored.
- **People:** each person in the people file who appears in a stored message is matched to a row in `people` by `id`. With no row for that id, a row with the same display name and no id yet (made earlier by `person add`) is adopted. Otherwise a row is created, without an account (`person add --name <display name>` gives it a link later). A changed display name updates the same row; if the new name belongs to someone else the import stops and says so. There is never a second row for one id.
- **A memory's date** is when its first photo was sent, read in `--timezone`. The time zone is kept with the chat and the app shows the date in it. It is **fixed at the chat's first import**: importing the same chat again with another `--timezone` stops with a message and changes nothing.
- **Photos:** each is stored twice in the private bucket `photos`, as WebP: a viewing size (longest side at most 1600 px) and a small one for the timeline (720 px). Photos that are already smaller are not enlarged. The photo's own metadata (such as where it was taken) is dropped. Originals are never uploaded. A photo this build cannot read, such as an iPhone HEIC photo (issue 12), is listed under problems and is stored as a photo message without a photo; the rest is imported.
- **Lasting keys.** A WhatsApp export has no message ids, so each row carries a key made from the chat's content, for the later import of a newer export (issue 13) and for hiding (issue 20). The time zone, the UTC instant, the display name, the photo's file name and a photo's caption are never part of a key.
  - Discord: the export has Discord's own lasting ids, so no recipe is needed. A message's key is made from the chat's key and its message id, a photo's (also the key of its message) from the chat's key and its attachment id. Edited text, a changed name or a newer export never change a key. A memory's key is that of its first photo, as for WhatsApp.
  - chat: the app and the name, without case and surrounding spaces (`whatsapp:kaş tatili`, `discord:kış sunucusu`);
  - message: hash of chat key, the clock time as written in the export cut to the minute (`2023-07-14 20:58`), the person's `id`, the kind of media (empty for text), the text, and its position among identical ones in the chat (two "tamam" in the same minute are two messages);
  - photo (also the key of its message): the same, but without the text: chat, clock minute, person `id`, and its position among that person's photos in that minute, so an edited caption stays the same photo;
  - memory: the key of its first photo **message**, whether or not that photo's file is in the export or can be read. A photo message without a readable file still counts for grouping and for the key; only its files and its `photos` row are missing, and a later import that has the file adds them to the same memory.
- A memory with no stored photo is not shown on the timeline. A `photos` row exists only when both of its files are in the bucket.
- If saving fails (the bucket or the database), the command prints one plain line and exits with an error. Files go first and rows are written by key, so running the same import again finishes the job.
- Saving is by key, so saving the same export twice leaves one copy. Making a second import correct (new grouping, hidden marks, comments) is issues 13 and 20.

## What the trial run prints

The number of memories, photos and people, the date range, the problems found (such as photos missing from the export), and one line per memory.

## Not handled yet

- Phone numbers inside message text are stored as written (issue 12). Do not import real chats into a shared stack before that.
- A newer export that changes grouping can leave an older memory behind (issue 13).
