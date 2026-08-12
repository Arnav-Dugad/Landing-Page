# Landing-Page

**Live:** https://arnav-dugad.github.io/Landing-Page/

A light, editorial portfolio built as a single static site — warm paper, near-black
ink, one vermillion accent. Every project is stored in **Firebase Firestore** and
streamed in live, so the site updates itself the moment a project is added or edited.

No framework. No build step. No bundler. No CDN for CSS or icons.

---

## Design

| | |
|---|---|
| **Ground** | `#FBFAF7` warm paper — never pure white |
| **Ink** | `#141210` warm near-black |
| **Accent** | `#D14424` vermillion, used sparingly on purpose |
| **Display** | Fraunces (variable — `opsz`, `SOFT`, `WONK` axes) |
| **Interface** | Inter Tight |
| **Mono** | JetBrains Mono |

Every value lives in [`css/tokens.css`](css/tokens.css). Nothing downstream hardcodes
a colour, radius, easing curve or duration.

## Features

**The work**
- **Live from Firestore** — projects arrive over a realtime `onSnapshot`
  subscription; skeletons hold the layout until the first snapshot lands.
- **Full project editing** — add, **edit**, duplicate and delete from an editor
  sheet with a live preview that renders through the *same* component the grid uses.
- **Detail sheet** — running preview of the real site in an iframe, write-up,
  highlights, tech, GitHub stats, animated language bar, share, and ←/→ navigation.
- **Real GitHub data** — stars, forks, last push and language breakdown. The repo is
  either explicit or **derived** from a `<user>.github.io/<name>` link, so link-only
  projects still get stats. Cached in `localStorage` for 6h and deduped in flight.
- **Derived, not declared** — the category filters, the stats strip and the entire
  Stack section are all computed from the projects that actually exist. Nothing on
  this page is a hardcoded list.
- **Deep links** — `#project-slug` opens that project directly.

**The craft**
- **⌘K command palette** — fuzzy search across projects, navigation, filters,
  sorting, layout and admin actions. Everything on the site is keyboard-reachable.
- **Interactive dot lattice** — a canvas field behind the page that responds to the
  cursor with a smootherstep falloff, ripples on click and drifts with scroll.
- **Word-mask headline reveals**, glyph-scramble role line, odometer counters that
  roll digit by digit, a marquee whose speed and direction follow your scroll,
  spring-damped 3D card tilt with a pointer-tracked sheen, and a custom cursor that
  morphs into a verb over anything clickable.
- **View Transitions API** for filter and sort re-layouts, where supported.
- **Reduced motion is a first-class path**, not an afterthought — ambience stops,
  the custom cursor and intro curtain disappear, state changes stay legible.

## Structure

```
index.html            Semantic markup only — no app logic, no framework classes
css/tokens.css        Design tokens, reset, base typography, utilities
css/layout.css        Backdrop, nav, hero, section rhythm, marquee, footer, rail
css/components.css    Buttons, cards, sheets, forms, palette, toasts, cursor
css/motion.css        Reveal vocabulary + every keyframe

js/icons.js           Hand-drawn 24px SVG icon set + legacy `fa-*` mapping
js/motion.js          Reveals, split text, magnetic, tilt, cursor, odometer, marquee
js/backdrop.js        The interactive dot lattice
js/github.js          GitHub stats/languages, repo resolution, deploy detection
js/render.js          Cards, filters, stats, stack band, detail sheet, deep links
js/admin.js           Add / edit / duplicate / delete + live preview
js/palette.js         ⌘K command palette
js/app.js             Sheets, toasts, dialogs, sound, contact, curtain, shortcuts
js/firebase.js        Firebase init + the entire Firestore data layer (module)

firestore.rules       Security rules — deploy from the Firebase console
vercel.json           Headers + caching for Vercel
```

Classic scripts run first and define the UI surface; `firebase.js` loads last as a
module and pushes live data into an already-initialised interface. One rAF loop in
`motion.js` drives everything that animates per frame — the site never runs
competing render loops.

## Editing projects

1. Click the lock in the footer (or ⌘K → *Unlock admin mode*) and enter the PIN.
2. Hover any card for **edit**, **duplicate** and **delete**; or use *Add a project*.
3. Save. The change is live immediately — no rebuild, no deploy.

The PIN gate hides the controls; it is **not** the security boundary. What actually
decides whether a write lands is `firestore.rules`. For genuinely admin-only writes,
switch to Email/Password auth and replace the `signedIn()` checks with
`request.auth.uid == "<your-admin-uid>"`.

## Running locally

ES modules and Firebase need a real origin — `file://` will not work.

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Deploying

**GitHub Pages** — already wired. Pushing to `main` updates the live site.

**Vercel** — import `Arnav-Dugad/Landing-Page` at
[vercel.com/new](https://vercel.com/new). It is a static site, so accept the
defaults:

| Setting | Value |
|---|---|
| Framework preset | **Other** |
| Build command | *(leave empty)* |
| Output directory | *(leave empty — repo root)* |
| Install command | *(leave empty)* |

`vercel.json` supplies security headers and cache policy. After the first deploy,
every push to `main` ships automatically.

One thing to do once the Vercel URL exists: add it to **Firebase console → Authentication
→ Settings → Authorized domains**, otherwise anonymous sign-in is blocked there and no
projects will load.

## Firebase

Data lives under `artifacts/arnav-portfolio-v1/public/data/{projects,messages,stats}`.
`firestore.rules` validates payload shape and size and keeps the contact inbox
private — deploy it from **Firebase console → Firestore → Rules**. Editing the file
alone does not change the live rules.

---

Arnav Dugad © 2026
