# Rehosted projects (Vercel → Cloudflare Workers)

On 2026-11-13 nine projects whose Vercel deployments had stopped (the Vercel
account is blocked, so every `*.vercel.app` link answered HTTP 402) were
rebuilt from their GitHub repos and deployed as Cloudflare Workers with
static assets, at `https://<worker>.arnavd.workers.dev/`. Each project's
`link` on the portfolio was updated to match.

None of these changes were pushed to the projects' own repos. This folder
keeps them so a redeploy can reproduce what is live: for each project,
`changes.patch` (edits to tracked files) and any new files.

| Folder | Worker | How it's built |
|---|---|---|
| `AccuWeather` | `accuweather` | `npm ci && npm run build` → `dist/` |
| `casio-fx-991es-plus-emulator` | `casio-fx-991es-plus` | Vite → `dist/` |
| `global-transport-tycoon` | `global-transport-tycoon` | Vite → `dist/` |
| `country-simulator` | `country-simulator` | Vite → `dist/` (no Firebase env: offline saves) |
| `urbana` | `urbana` | Vite → `dist/` + `cf-worker.js` serving `/api/geocode` and `/api/overpass` (ported Vercel functions); basemap moved off CARTO, which now watermarks every tile without an API key |
| `File-Sharing` | `file-sharing` | static files copied to `public-cf/` + `_headers` (from `vercel.json`) + `cf-worker.js` for `/api/ice`, `/api/scope`, `/api/health` on Web Crypto; secret `SCOPE_SALT` set with `wrangler secret put` |
| `Asterwind-Valley` | `asterwind-valley` | Next.js static export (`output: "export"`) → `out/` |
| `video-streaming` (Prism) | `prism` | Next 16.4.5 + `@opennextjs/cloudflare`, `next build --webpack`, Firestore aliased to its browser build |
| `meridian-terminal` | `meridian-terminal` | as Prism, plus a `firebase-admin` stub and ISR pages made `force-dynamic` |

## Redeploying one

```sh
git clone https://github.com/Arnav-Dugad/<repo>.git && cd <repo>
git apply ../tools/rehost/<folder>/changes.patch      # if non-empty
cp -r ../tools/rehost/<folder>/* .                     # new files (skip changes.patch)
npm ci && npm run build                                # see the table
npx wrangler deploy --config wrangler.cf.jsonc         # Prism/Meridian: npx opennextjs-cloudflare build && npx wrangler deploy
```

## Why the Next.js apps needed changes

- **Next 16.4.5+** is the minimum `@opennextjs/cloudflare` supports.
- **`--webpack`**: Turbopack's server output generates code at runtime,
  which Workers forbid.
- **Firestore browser build**: the Node build pulls in protobufjs, which also
  generates code at runtime (`EvalError: Code generation from strings
  disallowed`). The browser build talks HTTPS and runs fine on Workers.
- **Meridian `force-dynamic`**: the ISR pages were prerendered at build and
  threw "Page changed from static to dynamic at runtime" on revalidation
  (a `no-store` fetch to Yahoo). They now render per request.

The original Vercel environment variables (YouTube, market-data and TURN keys,
Firebase configs) couldn't be recovered, so these apps run in their built-in
keyless modes until keys are added as Worker secrets.

Not moved: **Eduwards** (eduwards.com) — its DNS is at GoDaddy and it needs
production secrets, so it's a decision for the owner.
