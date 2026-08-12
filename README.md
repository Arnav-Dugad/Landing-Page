# Landing-Page

**Live:** https://www.arnavdugad.in/  ·  mirror: https://arnav-dugad.github.io/Landing-Page/

A light, editorial portfolio built as a single static site — warm paper, near-black
ink, one vermillion accent. Every project is stored in **Firebase Firestore** and
streamed in live, so the site updates itself the moment a project is added or edited.

No framework. No build step. No bundler. No CDN for CSS or icons.

---

## Design

| | Light | Dark |
|---|---|---|
| **Ground** | `#F7F5F0` warm paper | `#131110` warm near-black |
| **Ink** | `#100E0C` | `#FAF7F1` |
| **Accent** | `#C43E1F` vermillion | `#F2764E` |
| **Display** | Fraunces (variable — `opsz`, `SOFT`, `WONK` axes) | ← |
| **Interface** | Inter Tight | ← |
| **Mono** | JetBrains Mono | ← |

Every value lives in [`css/tokens.css`](css/tokens.css). Nothing downstream hardcodes
a colour, radius, easing curve or duration.

**Contrast is a constraint, not a preference.** Every text tone in both themes clears
WCAG AA against its own background — the weakest link in the ramp is `--ink-35` at
**5.14:1** (light) and **5.01:1** (dark), and that tone is only used for meta text.
Dark mode is a full restatement of the ramp, not a filter: the duotones lift toward
the light end, the card sheen inverts, and the canvas lattice repaints in paper
instead of ink.

Theme follows the OS by default and cycles **System → Light → Dark** from the nav,
the footer, the palette or <kbd>T</kbd>. It is applied by an inline script in `<head>`,
so the page never flashes the wrong palette.

## Features

**The work**
- **Live from Firestore** — projects arrive over a realtime `onSnapshot`
  subscription; skeletons hold the layout until the first snapshot lands.
- **Full project editing** — add, **edit**, duplicate, **drag to reorder** and delete
  from an editor sheet with a live preview that renders through the *same* component
  the grid uses. Deletes are undoable; long write-ups autosave as drafts.
- **Case-study pages** — mark a project as a case study and it gets a full page at
  `case.html?p=<slug>`: problem, approach, a numbered "what broke" list, outcome,
  metrics and a zoomable screenshot gallery.
- **Per-project link previews** — sharing a project produces a real
  [social card](#open-graph) generated at request time from its live record.
- **Detail sheet** — running preview of the real site in an iframe, write-up,
  highlights, tech, GitHub stats, animated language bar, share, and ←/→ navigation.
- **Real GitHub data** — stars, forks, last push and language breakdown. The repo is
  either explicit or **derived** from a `<user>.github.io/<name>` link, so link-only
  projects still get stats. Cached in `localStorage` for 6h and deduped in flight.
- **Automatic tech detection** — a project's tech list is *worked out*, not typed.
  Three signals are merged: the repo's `/languages`, its `package.json`
  dependencies (which is the only way to learn it uses Three.js or Next.js), and
  its topics — plus the deploy platform inferred from the live URL. One admin
  button backfills the whole collection.
- **Auto-populate** — the same pass fills any blank description (from the repo),
  year (from its creation date), status (GitHub's archived flag), repo link and
  live URL, and guesses a category, colour and icon from the title and blurb.
  It never overwrites something written by hand.
- **Derived, not declared** — the category filters, the stats strip and the entire
  Stack section are all computed from the projects that actually exist. Nothing on
  this page is a hardcoded list.
- **Actions where you need them** — every card carries **Visit** and **Code**
  buttons directly, and the detail sheet keeps them in a sticky header rather than
  below the write-up.
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
- **FLIP re-layout** — filtering measures every card, changes the DOM, then plays
  each card from where it *was* to where it now is, so the grid physically
  rearranges instead of blinking.
- **A travelling filter indicator** — one pill that moves between chips rather than
  each chip painting its own background.
- **Scroll-linked text illumination** — words in the About copy brighten as the
  paragraph rises through the viewport. JS writes one number; every word derives
  its own opacity from it in CSS.
- **Real card depth** — the plaque, title and actions sit on separate Z planes, so
  tilting a card parallaxes them instead of moving one flat face.
- **Scroll-velocity skew** on the grid, and **cross-document View Transitions** so
  navigating to a case study is one continuous move rather than a white flash.
- **Reduced motion is a first-class path**, not an afterthought — ambience stops,
  the custom cursor and intro curtain disappear, state changes stay legible.
- **Shareable views** — the filter, sort, search and layout live in the query
  string, so `/?cat=game&sort=stars` is a link you can send someone.
- **Keyboard shortcuts** — <kbd>⌘K</kbd> palette, <kbd>/</kbd> search, <kbd>G</kbd>
  layout, <kbd>T</kbd> theme, <kbd>R</kbd> random, <kbd>←</kbd><kbd>→</kbd> between
  projects, <kbd>?</kbd> for the full list. Arrow keys walk the grid itself,
  reading the real column count from the layout so it works at every breakpoint.
- **Prints cleanly** — a dedicated print stylesheet strips the chrome and expands
  link URLs, so the portfolio survives being turned into a PDF.

<h3 id="open-graph">Open Graph</h3>

A hash fragment is never sent to a server, so `/#project-slug` can never carry
per-project preview tags — a crawler only ever sees the homepage. Two edge functions
fix that:

- **`/p/<slug>`** ([`api/share.js`](api/share.js)) returns a small document with that
  project's real title, description and image, then forwards a human to the site.
- **`/api/og?p=<slug>`** ([`api/og.js`](api/og.js)) renders a 1200×630 card at request
  time from the live Firestore record — the project's own duotone, tags and copy, set
  in Fraunces. Nothing is pre-built, so a card is correct the moment you edit a project.

A third function, [`api/sitemap.js`](api/sitemap.js), generates `/sitemap.xml` from
Firestore so every `/p/<slug>` route — and every case study — is independently
indexable. It is regenerated per request, so a project added this afternoon is in
the sitemap this afternoon.

This is the only part of the site with a dependency (`@vercel/og`) and the only part
that needs a server. Everything else still runs as plain static files — on GitHub
Pages the share button simply falls back to the hash deep link.

## Structure

```
index.html            Semantic markup only — no app logic, no framework classes
case.html             The long-form case-study page

css/tokens.css        Design tokens (both themes), reset, typography, utilities
css/layout.css        Backdrop, nav, hero, section rhythm, marquee, footer, rail
css/components.css    Buttons, cards, sheets, forms, palette, toasts, cursor
css/motion.css        Reveal vocabulary + every keyframe
css/case.css          Case-study layout

js/icons.js           Hand-drawn 24px SVG icon set + legacy `fa-*` mapping
js/theme.js           Light / dark / system switching
js/motion.js          Reveals, split text, magnetic, tilt, cursor, odometer, marquee
js/backdrop.js        The interactive dot lattice
js/github.js          GitHub stats/languages, repo resolution, deploy detection
js/render.js          Cards, filters, stats, stack band, detail sheet, deep links
js/admin.js           Add / edit / duplicate / delete, drafts, admin sign-in
js/palette.js         ⌘K command palette
js/app.js             Sheets, toasts, dialogs, sound, contact, curtain, shortcuts
js/case.js            Renders the case-study page from one project record
js/firebase.js        Firebase init + the entire Firestore data layer (module)

js/enrich.js          Automatic tech detection + project auto-population
js/reorder.js         Drag-to-reorder with FLIP

api/_project.js       Shared Firestore REST reader for the edge functions
api/og.js             GET /api/og?p=<slug> → 1200x630 social card
api/share.js          GET /p/<slug> → per-project Open Graph tags
api/sitemap.js        GET /sitemap.xml → every project, generated live

firestore.rules       Security rules — deploy from the Firebase console
vercel.json           Rewrites, headers and caching for Vercel
package.json          Exists only for @vercel/og; the pages have no dependencies
```

Classic scripts run first and define the UI surface; `firebase.js` loads last as a
module and pushes live data into an already-initialised interface. One rAF loop in
`motion.js` drives everything that animates per frame — the site never runs
competing render loops.

## Editing projects

1. Click the padlock in the footer (or ⌘K → *Unlock admin mode*) and sign in.
2. Hover any card for **drag**, **edit**, **duplicate** and **delete**; or use
   *Add a project*.
3. Save. The change is live immediately — no rebuild, no deploy.

Drag-to-reorder writes an `order` field to every card in one atomic batch and
switches the sort to *Custom order* so you can see what you did. It is only offered
with no filter or search active — writing `1..n` over a filtered subset would
scramble it against the projects you can't see.

### Admin access is real auth

Admin is a **Firebase Email/Password account**, and `firestore.rules` checks that
identity on every write. Hiding the edit buttons is cosmetic; the rules are what stop
somebody writing to the collection straight from the console.

Set it up **in this order** — the other way round locks you out:

1. Firebase console → **Authentication → Sign-in method** → enable *Email/Password*.
2. **Authentication → Users → Add user**, with a long unique password.
3. Sign in on the site via the footer padlock and confirm it works.
4. *Then* publish `firestore.rules` (edit `adminEmail()` first if the address differs).

Visitors stay signed in anonymously, which is what lets them read projects, send a
message and bump the visit counter — and nothing else.

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

`vercel.json` supplies the `/p/:slug` rewrite, security headers and cache policy.
After the first deploy, every push to `main` ships automatically.

Two one-time steps:

- Add the deployed domain to **Firebase console → Authentication → Settings →
  Authorized domains**, otherwise sign-in is blocked there and no projects load.
- Turn on **Analytics** and **Speed Insights** in the Vercel project dashboard. The
  script tags are already in the pages; until the features are enabled those paths
  return 404 and nothing else is affected.

**Analytics** is wired via `/_vercel/insights/script.js` and
`/_vercel/speed-insights/script.js` — no npm package, no React provider.

## Firebase

Data lives under `artifacts/arnav-portfolio-v1/public/data/{projects,messages,stats}`.
`firestore.rules` validates payload shape and size and keeps the contact inbox
private — deploy it from **Firebase console → Firestore → Rules**. Editing the file
alone does not change the live rules.

---

Arnav Dugad © 2026
