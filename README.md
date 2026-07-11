# Landing-Page

**Live:** https://arnav-dugad.github.io/Landing-Page/

A premium, animated portfolio that showcases my projects. All project data is
stored in **Firebase Firestore** (nothing is hardcoded) and rendered live, so
the site updates itself the moment a project is added or removed.

## Features

- **Everything from Firebase** — projects load live from Firestore via a realtime
  `onSnapshot` subscription; skeletons show while loading.
- **Project detail modal** — click any card for a live in-page preview, full
  write-up, tags, GitHub stats, a language bar, **Visit Live** / **View Code** /
  **Share**, and ←/→ navigation between projects.
- **Automatic GitHub stats** — stars, forks, last-push and a language breakdown,
  pulled from the GitHub API. The repo is taken from an explicit `repo` field or
  **auto-derived** from a `<user>.github.io/<name>` link, so link-only projects
  still get stats. Cached in `localStorage` (6h) and deduped to respect limits.
- **Portfolio stats bar** — live totals: projects, GitHub stars, technologies,
  categories, with a count-up animation.
- **Sorting & featured** — sort by Newest / Most-Starred / A–Z / Featured;
  featured projects pin to the top.
- **Rich project data** — status badge (Live / In Progress / Archived),
  auto-detected deploy badge (GitHub Pages / Vercel / Netlify / Firebase),
  detailed write-up, and a large set of language/framework/tool quick-tags.
- **Admin mode** — PIN-gated add/delete of projects with a live card preview.
- **Premium animations** — animated gradient background, starfield with
  cursor-linked constellations, custom cursor, magnetic buttons, 3D card tilt,
  confetti, loading screen, and a typed hero tagline. All respect
  `prefers-reduced-motion`.
- **Extras** — search (Ctrl+K), category filters, grid/list toggle, theme
  switcher (Ctrl+B), contact form, visitor counter, live clock, opt-in weather,
  and UI sound effects.

## Project structure

```
index.html          Markup + Tailwind config (no inline app logic)
css/styles.css      All styles, animations, and premium components
js/render.js        Cards, badges, stats bar, sorting, detail modal (presentation)
js/github.js        GitHub stats/languages, repo resolution, deploy detection
js/ui.js            Toasts, modals, filters/search/sort, admin, add-project form
js/effects.js       Starfield, cursor, confetti, audio, clock, weather, hero
js/firebase.js      Firebase init + the entire Firestore data layer (module)
firestore.rules     Security rules (deploy via the Firebase console)
```

Scripts load as `github`/`render`/`ui`/`effects` (classic) → `firebase.js`
(module, last), so the data layer pushes live data into an already-initialized UI.

## Running locally

Serve over HTTP (ES modules and Firebase don't work from `file://`):

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Firebase

Project data lives under `artifacts/arnav-portfolio-v1/public/data/{projects,messages,stats}`.
`firestore.rules` locks writes to authenticated sessions with payload
validation and keeps the contact inbox private — **deploy it from the Firebase
console → Firestore → Rules** (editing the file alone doesn't update the live
rules).

<img width="1878" height="1055" alt="image" src="https://github.com/user-attachments/assets/5685c49c-b6cd-4b93-b151-0f5b622d9f3a" />


<img width="1883" height="1053" alt="image" src="https://github.com/user-attachments/assets/974b7d1f-d476-486b-911b-4b3a704574a5" />


<img width="1884" height="1051" alt="image" src="https://github.com/user-attachments/assets/aced1e62-7ed8-47a9-96fd-93e3e0ce889a" />


------------------------------------------------------------------------------------------------------------------------------------
Arnav Dugad © 2026
