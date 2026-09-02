# PUBLISHING flisolutions.io — read before any deploy

**This repo root is NOT the website.** It is the source repo for both the FLi
marketing site and Corsair, and it contains internal ops documentation,
Firebase functions, and infrastructure config that must never be served
publicly. The public web root is a **subset**, enumerated below.

Until 2026-09-01 the whole repo root *was* the publish root, so every
`corsair-*.md`, `CLAUDE.md`, and `database.rules.json` was readable at
`https://flisolutions.io/<filename>`. That is closed. **A deploy built from the
repo root would silently reopen it in one move.**

---

## 1. Netlify is NOT connected to this repo

Netlify → Project configuration → Build & deploy reads **"Current repository:
Not linked."** Pushing to `main` does **not** deploy the site. This repo is
version control; deployment is a separate, manual act.

Historic deploys labelled `main@<sha>` came from `netlify-cli` runs, which is
what made several sessions believe a Git integration existed. It does not.

## 2. THE PUBLISH SET — exactly these, nothing else

```
index.html
FLiIntel.html
FLiIntel.css
js/                      (whole directory)
sw.js
FLi_Capabilities_Statement.pdf
fli-share-2026-09.png    (og:image / twitter:image target)
fli-social-preview.png   (legacy share URL — kept so already-shared cards live)
robots.txt
sitemap.xml
clear.html               (linked from FLiIntel.html)
g2-outreach.html         (linked from FLiIntel.html)
```

26 files total including the `js/` tree. **Everything else in this repo stays
out of the deploy.**

Deliberately excluded, with reasons:

| Excluded | Why |
| --- | --- |
| `CLAUDE.md`, `corsair-*.md`, `mission-*.md` | Internal ops record — partners, pipeline, doctrine |
| `database.rules.json`, `firebase.json`, `.firebaserc` | Firebase security rules and infra config |
| `functions/` | **Firebase** functions. Netlify tries to bundle them as its own and the build FAILS at "Functions bundling" with exit code 2 |
| `import.html`, `import-orders.html` | Render Atlas figures before their sign-in gate |
| `index-1.html`, `preview.html`, `instrument-preview.html` | Stale build snapshots |
| `era01_corsair.mp4` | 890KB, referenced by nothing |
| `CNAME` | GitHub Pages artifact, meaningless to Netlify |
| `.claude/`, `.github/`, `.githooks/`, `scripts/`, `_archived/` | Tooling and dead code |

## 3. HOW TO DEPLOY

```bash
# 1. Start from what is ACTUALLY LIVE, not from repo HEAD, unless
#    shipping HEAD is the explicit intent. Get the published sha from
#    the Netlify deploy list.
git worktree add --detach /tmp/livetree <published-sha>
cd /tmp/livetree

# 2. Make the change.

# 3. Build the zip — the exclusions are not optional.
zip -qr /tmp/site.zip . \
  -x '.git*' 'functions/*' '.claude/*' '.github/*' '.githooks/*' \
     'scripts/*' '_archived/*' \
     'CLAUDE.md' 'corsair-*.md' 'mission-*.md' \
     'firebase.json' '.firebaserc' 'database.rules.json' \
     'index-1.html' 'preview.html' 'instrument-preview.html' \
     'era01_corsair.mp4' 'import.html' 'import-orders.html' 'CNAME'

# 4. Confirm the manifest before uploading.
unzip -l /tmp/site.zip | grep -E '\.(md|json)$'   # must return nothing
```

Then: **Netlify → Project overview → "Production deploys — Drag and drop your
project folder here to deploy new changes" → browse files to upload.**

**NEVER use the drop zone on the Projects *list* page** — that creates a brand
new site. Four orphan sites were created that way in August 2026.

## 4. VERIFY FROM THE LIVE ORIGIN, NOT THE DASHBOARD

A green "Published" is not proof. From the browser console on
`https://flisolutions.io`:

```js
// changed file: sha256 must match the local file you built
const b = await (await fetch('/<changed-file>', {cache:'no-store'})).arrayBuffer();
const h = await crypto.subtle.digest('SHA-256', b);
[...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');

// and confirm the excluded set is gone
for (const u of ['/CLAUDE.md','/corsair-ops-truth-v1.md','/database.rules.json'])
  console.log(u, (await fetch(u, {cache:'no-store'})).status);   // expect 404
```

Also re-check **Netlify → Forms**: a zip deploy can drop form registration.
The `contact` form must still be listed as active.

## 5. COST

Every production deploy costs roughly **15 credits (~$0.15)**; the plan covers
about **66 per month**. In the Aug 2026 cycle, 133 deploys consumed 1,995 of
2,010 credits and Netlify paused **every project on the team** — the marketing
site and Corsair went down together. Bandwidth was 13 credits of that; deploy
count was the whole problem.

**Batch changes. Never deploy to verify.**

---

*Written 2026-09-01 after the publish-root cleanup. If you change the publish
set, change this file in the same commit.*
