// @ts-check
import { defineConfig } from 'astro/config';

// ---------------------------------------------------------------------------
// Deployment configuration
//
// GitHub Pages (project site, e.g. https://<user>.github.io/rct-recert):
//   site: 'https://<user>.github.io',
//   base: '/rct-recert',
//
// GitHub Pages (user/org site or custom domain), Cloudflare Pages, Netlify:
//   site: 'https://your-domain.example',
//   base: '/',   (or omit)
//
// Set these before your first deploy. `base` matters: with a project-site
// path prefix, all internal links must go through the `withBase()` helper in
// src/lib/paths.ts so they keep working under the subpath.
// ---------------------------------------------------------------------------

// The GitHub Pages workflow injects the real values (SITE_URL / SITE_BASE) at
// build time. Locally these fall back to root so `npm run dev` just works. If
// you deploy this as a GitHub *project* site by hand, set SITE_BASE=/rct-recert
// (or your repo name) when you run `npm run build`.
const SITE = process.env.SITE_URL || 'https://example.com';
// Always end with a slash ('/rct-recert/'): several pages build URLs as BASE_URL + 'path'.
const RAW_BASE = process.env.SITE_BASE && process.env.SITE_BASE !== '' ? process.env.SITE_BASE : '/';
const BASE = RAW_BASE.replace(/\/*$/, '/');

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});
