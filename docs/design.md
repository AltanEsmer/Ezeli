# Design

The Quiet Gallery look: neutral surfaces, the photos as the only colour, one terracotta accent. Dark is the first theme and light gets equal care. The theme follows the device; there is no switch. Source: spec issue 50. Each screen ticket adds its screen to the end of this file and deletes its old styles.

## Where the styles live

All in `src/styles/`, loaded in this order by `src/main.tsx`.

| File | Holds | Who edits it |
|---|---|---|
| `tokens.css` | the tokens below, the base (reset, body, focus, `.btn`, the fade) | anyone adding a token |
| `shell.css` | the bar, the menu, the small pages | the shell only |
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
