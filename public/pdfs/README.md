# PDF study guides

Put your PDF files in this folder. Anything here is copied verbatim to the
built site and served at `/<base>/pdfs/<filename>`.

After adding a file, register it in `src/data/study-guides.json`:

```json
{
  "title": "Radiological Fundamentals Review",
  "description": "One-line summary shown under the title.",
  "file": "rad-fundamentals-review.pdf",
  "category": "Fundamentals",
  "pages": 24,
  "updated": "2026-09-01"
}
```

- `file` must match the filename here exactly (case-sensitive).
- `category` groups files into sections on the Study Guides page.
- `pages` is optional; `updated` is a plain `YYYY-MM-DD` string.
- File size is measured automatically at build time.

Keep individual files under 100 MB if you deploy to GitHub Pages. For large
scanned documents, prefer Cloudflare Pages or link out to an official host.
