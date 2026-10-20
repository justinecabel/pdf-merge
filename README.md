# PDF Merge

Browser-based PDF mail merge. Run `npm ci` and `npm run dev`, then open
<http://localhost:3000>.

## Folder layout

- `app/`: application source, components, routes, and unit tests. Keep tracked.
- `public/`: assets intended for public download: `favicon.svg` and the bundled
  fonts in `public/fonts/`. Keep tracked. Vite copies this folder into the site.
- `.github/`: GitHub Actions configuration. Keep tracked.
- `.tmp/`, `tmp/`, `temp/`, `work/`, `outputs/`: local scratch scripts, input PDFs,
  sample exports, and working files. Ignored by Git; `.tmp/` is the preferred
  location for temporary PDFs.
- `node_modules/`, `.next/`, `.vinext/`, `.cache/`, `.vite/`: installed dependencies
  and generated caches. Ignored by Git.
- `dist/`, `out/`, `coverage/`: generated build and test output. Ignored by Git.

Keep local PDFs, merge data, and temporary exports outside `public/`. Git ignore
rules control tracking, not publication: files inside `public/` are copied into
the build even when Git ignores them. Local environment files (`.env*`) are also
ignored and belong outside `public/`.

## GitHub Pages

The deployment workflow builds with `NEXT_PUBLIC_BASE_PATH=/pdf-merge` and uploads
only `dist/client/`. This contains exported pages, browser bundles, PDF/ML worker
assets, the favicon, and fonts. Application source, local scratch files,
dependencies, and `dist/server/` are outside the Pages artifact.

To verify locally, run `npm run lint`, `npm test`, and
`NEXT_PUBLIC_BASE_PATH=/pdf-merge npm run build`.
