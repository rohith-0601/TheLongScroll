# The Long Scroll

13.8 billion years of breakthroughs in one scroll. A single field of up to 1,000,000 GPU-simulated
particles re-forms into each chapter, live in the browser: WebGPU compute physics, with WebGL2 and
reduced-motion fallbacks and a static page when no WebGL is available.

- Spec: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · original brief: [docs/BRIEF.md](docs/BRIEF.md)
- Content (single source of truth): [data/chapters.ts](data/chapters.ts), [data/frontier.ts](data/frontier.ts)

## Develop

```bash
npm ci
npm run dev            # http://localhost:3000  (leva + stats-gl panels; ?clean hides them, ?studio opens Theatre)
npm run typecheck
node scripts/test-timeline.ts            # year counter / scroll timeline tests
node scripts/preview-formations.ts all   # validates the 9 particle formations, PNGs in .previews/
node theatre/build-camera-state.ts       # re-bakes theatre/camera.json from theatre/path.ts
```

## Build

```bash
npm run build          # static export → out/  (no server needed)
npm start              # serves out/ on http://localhost:3000
```

WebGPU needs a secure context: `https://` or `http://localhost`. Opening the site over a LAN IP
(`http://192.168…`) falls back to WebGL2.

## Deploy (all free)

**Live:** https://the-long-scroll.pages.dev (Cloudflare Pages project `the-long-scroll`, direct upload).
To redeploy after changes:

```bash
npm run build
cd /tmp && npx wrangler@4 pages deploy "<path-to-this-project>/out" --project-name the-long-scroll --branch main
```

Run wrangler from a folder OUTSIDE this project: inside a Next.js project, wrangler's auto-setup tries
to convert the app to Cloudflare Workers (OpenNext) and rewrites next.config.ts / package.json.
Never pass `--force` again (it was only needed once, to create the Pages project).

**Cloudflare Pages (recommended)**: Workers & Pages → Create → Pages → connect the Git repo →
framework preset *Next.js (Static HTML Export)*, build command `npm run build`, output directory
`out`, environment variable `NODE_VERSION=24`. `public/_headers` makes `/_next/static/*` cache for a
year (`immutable`) while HTML revalidates, so repeat visits download almost nothing.

**Vercel**: import the repo; zero config.

**Netlify**: import the repo; `netlify.toml` and `public/_headers` are picked up automatically.

**GitHub Pages**: push to `main`, then Settings → Pages → Source: *GitHub Actions*.
`.github/workflows/deploy-pages.yml` builds with the right base path for `user.github.io/<repo>/`.
