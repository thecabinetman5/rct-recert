// Prefix an internal path with Astro's configured `base` so links keep working
// when the site is served from a subpath (e.g. GitHub Pages project sites).
const BASE = import.meta.env.BASE_URL; // always has a trailing slash, e.g. "/rct-recert/"

export function withBase(path: string): string {
  const clean = path.replace(/^\/+/, '');
  return BASE.endsWith('/') ? BASE + clean : `${BASE}/${clean}`;
}
