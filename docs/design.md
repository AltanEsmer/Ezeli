# Design

The Quiet Gallery look: neutral surfaces, the photos as the only colour, one terracotta accent. Dark is the first theme and light gets equal care. The theme follows the device; there is no switch. Source: spec issue 50. Each screen ticket adds its screen to the end of this file and deletes its old styles.

## Where the styles live

All in `src/styles/`, loaded in this order by `src/main.tsx`.

| File | Holds | Who edits it |
|---|---|---|
| `tokens.css` | the tokens below, the base (reset, body, focus, `.btn`, the fade) | anyone adding a token |
| `shell.css` | the bar, the menu, the small pages | the shell only |
| `memory.css` | the memory screen and the full-screen photo (ticket 54) | the memory screen |
| `old.css` | the styles of the first build's screens. It maps the old names onto the tokens, so old screens sit on the new background | tickets 53 to 57 delete the rules of the screen they rebuild; ticket 58 deletes the file. Nothing new goes in |

A rebuilt screen gets its own file (for example `timeline.css`), imported in `main.tsx`, named for the screen and using only tokens. Class names of a screen are its own; shared names are only those in `tokens.css` and `shell.css` (`.btn`, `.bar`, `.sheet`, `.notice`, `.fade-in`).

## Colour tokens

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0E0F11` | `#FAFAF8` | page background |
| `--surface` | `#17181B` | `#FFFFFF` | blocks, the menu |
| `--ink` | `#ECECEA` | `#16181B` | text |
| `--muted` | `#9A9EA6` | `#6B7078` | secondary text |
| `--line` | `#26282C` | `#E6E6E1` | 1 px lines |
| `--accent` | `#E0734F` | `#A83E1C` | accent for text |
| `--mark` | `#E0734F` | `#C8502D` | accent for rules and marks |
| `--tint` | `--mark` 12% into `--surface` | `--mark` 8% into `--bg` | the block behind a comment |
| `--stage` | `#08090A` | `#F0F0EC` | the stage behind a large photo |

Text keeps 4.5 to 1 or more against what it sits on. No shadows, no tilt, no texture. Photos are the only strong colour.

## Type

Inter Tight (400, 600) for the interface, `--ui`. Newsreader (400, 400 italic) for the line of conversation on the timeline and for comments, `--serif`. Both are packaged by Fontsource (`@fontsource/inter-tight`, `@fontsource/newsreader`), the full files with their `unicode-range` so the Turkish letters come from the latin-ext part; nothing is fetched from another site. Names and chat text carry `lang="tr"`; the page carries `lang` of the labels.

| Token | Size | Use |
|---|---|---|
| `--text-sm` | 13px | small print, hints, counts |
| `--text-md` | 15px | body, bar |
| `--text-lg` | 18px | the name Ezeli, lead lines |
| `--text-xl` | 24px | names in the menu, section headings |
| `--text-xxl` | 32px | the heading of a small page, screen titles |

Weights are 400 and 600 only.

## Spacing and shape

Steps: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16 (the page gutter on a phone), `--space-5` 24, `--space-6` 40, `--space-7` 64. Photos sit in blocks with `--gap` 2px between them and `--radius` 6px corners. A target is at least 44 px high.

## The 900 px rule

Wide is a window of 900 px or more, narrow is less. In CSS it is `@media (min-width: 900px)`; there is no JavaScript for it. The wide layout is designed at 1440 px and must hold from 900 to 1920 px. No screen scrolls sideways at 390, 900, 1440 and 1920 px.

## The shell and the bar (ticket 52)

One `<nav class="bar" aria-label="Pages">` and one `<main class="content">` in `src/Shell.tsx`. The bar is the same markup at both sizes; CSS moves it.

- Wide: fixed on the left, `--side` (208px) wide. From the top: the name Ezeli (a link to the timeline), Memories, People, Search, and at the bottom the signed-in person's name, which opens the menu. The page has `padding-left: var(--side)`.
- Narrow: a sticky strip `--bar-h` (52px) high at the top: Ezeli on the left (a link to the timeline), then People, Search and the button Menu. Memories is not shown: Ezeli leads there.
- The current place has `aria-current="page"`: marked by an accent rule (under the link on narrow, beside it on wide) and ink text. Memories is current on the timeline and a memory, People on people and a person, Search on search.
- A memory on a narrow window has no bar, only its own back link, so the photo gets the room (`.shell.bare`). On a wide window the bar stays.
- A screen change is a new `<main>` that fades in (`.fade-in`, 160 ms, `--fade`). With the device set to less motion nothing animates.
- Every control shows the keyboard focus: a 2px accent outline, 2px offset.

## The menu

A dialog (`role="dialog"`, `aria-modal`) card of 360px at most, centred under the top, over a dimmed page, opened by the bar's person button (accessible name `Menu: <name>`). It holds, in order: "Signed in as", the name, the owner mark for an owner, the language switch (Türkçe and English, each in its own language, `aria-pressed`), and the sign-out button. The close button is first; Tab stays inside; Escape and the dimmed page close it and the focus goes back to the button. It fades in; it does not fade out.

## The small pages

The private page, the bad-link page and the failed page (`.notice`, a `<main>` with no bar): the name Ezeli in muted 18px, a heading (`--text-xxl`), one short paragraph in muted text (36 characters wide at most), all centred in the window, both sizes the same. One `.btn` under it where there is something to do (the failed page: Try again). No card, no decoration. A loading screen is an empty `<main aria-busy>` on the page background.

## A memory on a list, and the timeline (ticket 53)

One part draws a memory wherever a list of memories is shown: `MemoryItem` (`src/MemoryItem.tsx`, styles `memoryitem.css`). The timeline, a person's page and search results all use it; nothing else draws a memory. The timeline's own frame (month headings, list of years, ends, notes) is `src/Memories.tsx` with `timeline.css`.

**A memory (`article`, one link to the memory's address).** Date as a heading (15px, 600), the line of conversation (Newsreader italic, 18px narrow and 21px wide, 2 lines narrow and 4 wide, left out when the memory has no text), "Sent by" with the names, and the counts (13px, muted). The comment count is in the accent and is not there at all when there are none. Names and the line carry `lang="tr"`.

- Narrow: the block of photos, then the words, 38px between memories, about two to a screen. The block has 2px gaps and a 6px corner. One photo: as wide as the block, in its own shape from 1 to 1.6 (wide, never tall). Two: halves, 1.6 to 1. Three: one large on the left (2/3), two stacked. Four or more: two by two, 1.4 to 1; with more than four, the fourth carries "+N" (the photos not shown).
- Wide: one row, 46px apart. The words in a column of 280px, 40px gap, the photos on the right in a box 224px high, each at its own shape (0.4 to 3), 2px gaps. When all photos nearly fit, the row gives up height to show all, down to 188px. Otherwise as many as fit at 224px, then one more cut to what is left of the row (when at least 96px), and the last carries "+N". A memory carries at most six photos from the database; "+N" counts from the full count.
- A photo's place (`Shot`) holds its shape while loading and when failed (muted "Photo could not load"), on `--line`. The photo fades in (`--fade`) once loaded; with less motion it simply shows.
- The part reads the 900px rule with `matchMedia` (the same query as the CSS), because wide shows a different number of photos, not only a different layout.

**Month headings** (`h2`) are sticky: under the bar and the strip of years when narrow (`--bar-h` + 44px), at the top when wide. A jump scrolls the heading to exactly that place and focuses it. A month split across two loaded pages shows its heading once, with the first page.

**The list of years** (`navigation` named "Jump to a year or month", the year in view is `aria-current`, its months follow it as buttons named "March 2023"). Wide: fixed down the right edge, `--rail` (64px) wide, years and months 13px, vertical, centred, scrolls when long. Narrow: a sticky strip 44px high under the top bar, years and months in one row that scrolls along; the open year is scrolled to the start. The year in view is the last month heading above the top of the screen. Pressing a year opens its newest month, pressing a month opens it; both load around it in both directions and say "Loading" or "Could not load, Try again" near the bottom edge while a jump runs or after it failed.

**Wide frame.** The page is the content area right of the bar: 40px left, `--rail` + 24px right for the list of years, months at most 1180px wide. Narrow: 16px gutter on each memory and heading, the strip of years edge to edge.

**Empty and failed** timeline: a centred heading (24px), one muted sentence, and Try again where it helps (`.tl-note`).

## The memory screen (ticket 54)

`src/MemoryPage.tsx` with `memory.css` (classes `mem-*`, `nm`, `pic`, `gone`, `viewer`, `strip`, `slide`). The photo parts (`Pic`, `Viewer`) are in `src/Viewer.tsx`.

**Parts, in order:** the back link (a button: the list the friend came from, else "All memories"), the stage (a `figure`: one photo, a caption "Name, time" and "n / N"), the squares (a group labelled Photos; one button per photo, the shown one `aria-pressed`; none for a memory of one photo), then the column: the date as `h1` (with the weekday), the chat's name, the photo count, "Sent by" with names as links, the conversation (region "Conversation"), the comments, Earlier and Later memory.

- Narrow: one column, no bar (`.shell.bare`). The stage is edge to edge, at the shape of the first photo kept between 0.8 and 1.5 (it does not change when another photo is shown), photo contained on `--stage`. Squares 52px, 3px apart, in a row that scrolls along; the unshown ones at 45% opacity, the shown one with a 2px ink outline. Column gutter 16px.
- Wide: the bar stays. A grid of the stage side (left, sticky, as high as the window, on `--stage`, 40px sides, squares 48px centred) and a column of 420px (border on the left, 24px padding) that scrolls with the page. The left and right arrow keys move between the photos (not while the full-screen view is open or a box has the focus).
- Pressing the stage opens the full-screen view on that photo. A small photo in the conversation (a 64px square) opens the full-screen view on a phone and shows the photo on the stage on a PC, where the stage is in sight.
- The conversation is plain lines: a heading (level 4) per run of one sender with the time beside it (13px, name 600), the lines in 15px, links in the accent, no bubbles. Where the day changes a day line (level 3) with rules on both sides. A video, voice message, document, GIF or media not in the export is a muted italic line with the words used before. A conversation of more than twelve messages opens on nine (three before the first photo and the ones after it); a button above and one below, each naming how many messages it shows, open the rest.
- Names, the chat's name and messages carry `lang="tr"`; a name is a link of 44px (`.nm`) when the person has a lasting id.
- Comments (`Comments.tsx`, ticket 55) sit in the column after the conversation; see "Comments" below.
- A photo fades in when it has loaded (`Pic`); one that cannot load is a plain `--line` box in its shape (on the stage it keeps the shape inside the stage).
- The full-screen view: black, whatever the theme. A header with "n / N" and a Close button, arrows (a glyph, no circle) on both sides, the photos in a strip that snaps (swipe), Escape and the back button close it, Tab stays inside. It fades in and out (160ms); with less motion it just appears and goes.
- A memory that is not there, or failed to load: a small page in the `.notice` style (name, heading, one paragraph, buttons "Try again" where it helps and "All memories").

## Comments (ticket 55)

`src/Comments.tsx` with `comments.css` (classes `cm cm-*`). A comment is something written in Ezeli later, so it is set apart from the old chat. Who may add, delete (the writer, or an owner, after one "Delete this comment?" question) and what happens on a failed save or delete is unchanged. Nobody edits.

- A section (region "Comments") under a 1px line, 40px below the conversation: the heading `h2` "Comments" (13px, 600, accent), then one muted line, "Written here in Ezeli, later. Not part of the old chat."
- Each comment is an `article`: a block on `--tint` with a 2px `--mark` line on the left, 12px by 16px padding, 8px apart, square on the line side. The head is the writer's name (13px, 600, Inter Tight) and the date beside it (13px, muted, mixed 30% toward ink so it keeps 4.5 to 1 on the tint in light); the text is Newsreader 18px, line breaks kept. The name and the text carry `lang="tr"`.
- Delete is a text button (13px, 600, accent, 44px high) under the text, for the writer and for an owner. Asking: the question, a plain `.btn` "Yes, delete" and a text button "Keep it". A failed delete shows its line in accent text.
- Writing: a label "Add your note", one plain field (Newsreader 18px, `--surface`, 1px `--line`, 6px corners, 3 rows) and one `.btn` "Add comment" on the right, off until there is text. A new comment appears at once below the others and the field empties. A failed save shows a line in accent text under the button.
- Same at both sizes: the section fills the column (the page column narrow, the 420px column wide). No tilt, no shadow, no tape.
- Contrast: accent text on the tint is 4.87 to 1 in dark and 5.36 in light; the date 7.4 and 6.36.
