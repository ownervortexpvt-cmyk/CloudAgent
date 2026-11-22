# VORTEX — Official Website & App Hub

A complete, premium, futuristic **static website** for the VORTEX technology company.
Pure HTML + CSS + vanilla JavaScript — **no build step, no backend, no database**.
Designed to run perfectly on **GitHub Pages** from a single repository.

---

## ✨ What's inside

| Section | File | What it does |
|---|---|---|
| Home | `index.html` | Hero, featured apps, platform overview, update-system explainer |
| Apps Marketplace | `marketplace.html` | Full catalogue with platform filters |
| Android APK Downloads | `apk.html` | APK section + install guide |
| Progressive Web Apps | `pwa.html` | PWA section + "Add to Home screen" guide |
| Web Applications | `webapps.html` | Instantly-openable web apps |
| Version & Updates | `updates.html` | Latest versions, changelogs, personal update status |
| App Details | `app.html?id=APPID` | Detail page for **every** app (works for new apps too) |
| Privacy Policy | `privacy.html` | Honest, static-site-appropriate policy |
| Terms of Service | `terms.html` | Clear terms including "as is" software notice |
| Contact | `contact.html` | Privacy-friendly form (opens the visitor's email app) |
| **Admin Panel** | **`admin.html`** | Manage apps, links, versions, logo, settings, password |
| Custom 404 | `404.html` | Styled "page not found" fallback |

**Apps included:** FLAREX KING, APPVERSE, Cloud Agent, NEXA AI, NEXSEVA, NAXORA —
each with original icon, description, features, version, changelog and link slots.

**Key systems:**

- 🔗 **Download/open system** — every app has APK / EXE / Web link slots. Empty slots
  honestly show *"Coming Soon"* — **no fake URLs are ever shown.**
- 🔄 **"Update version available" system** — after a user downloads an app here, the
  site remembers that version *locally in their browser*. When you publish a newer
  version, the user sees an **"Update version available"** message (site banner +
  app cards + app page + updates page).
- 🔔 **Notification bell** — the navbar bell lights up whenever a new version or a
  new app is published, listing everything that is new since the visitor's last
  visit. Taking the update (download/open) clears its notification automatically.
- 🛠 **Admin Panel** — add/change/delete APK, EXE, Web and PWA links, bump versions, edit
  changelogs, add or remove apps, change the site logo and more. **No code edits needed.**
- ⚡ **One-click publish to GitHub** — the Admin Panel commits your data straight into your
  repository (GitHub Contents API). Cloudflare Pages / GitHub Pages rebuilds automatically and
  **every visitor** sees your apps within minutes. A JSON backup downloads automatically before
  every publish, so nothing can ever be lost.
- 🖼 **Custom logo anywhere, anytime** — upload your logo in the Admin Panel and it
  instantly replaces the default VORTEX mark across the header, footer, favicon
  and admin panel.
- 🔐 **Strong client-side security** — salted SHA-256 password hashing (Web Crypto),
  brute-force lockout with exponential backoff, 30-minute auto-lock session.

---

## 🚀 Quick start (local)

Just open `index.html` in a browser, or serve the folder:

```bash
# any static server works, e.g.
python3 -m http.server 8080
# then visit http://localhost:8080
```

---

## 🌍 Publish on GitHub Pages (single repository)

1. Create a repository on GitHub (e.g. `vortex-website`).
2. Upload **all files from this folder** to the repository root
   (keep the folder structure: `css/`, `js/`, `icons/`, …).
3. Repository **Settings → Pages** → Source: **Deploy from a branch** →
   Branch: `main` / Folder: `/ (root)` → Save.
4. Wait ~1 minute. Your site goes live at
   `https://YOUR-USERNAME.github.io/vortex-website/`.

Everything uses relative paths, so the site works at a repository sub-path
or a custom domain with zero changes.

---

## 🔑 The Admin Panel

**Where is it?** Three easy ways:

- Scroll to the **footer of any page** → the **"Admin Panel"** button (with a padlock icon).
- On a phone: open the **☰ menu** → the last item is **"Admin Panel"**.
- Or open `https://YOUR-SITE/admin.html` directly.

**Default password:** `1000391619244862`

> ⚠️ **Change the password immediately** (Admin Panel → 🔑 Password tab).
> Minimum 8 characters, letters + numbers; 12+ with a symbol is strongly recommended.

**Security features**

| Feature | Behaviour |
|---|---|
| Password storage | Salted **SHA-256 hash** only — never plain text |
| Brute force | After 5 wrong attempts the panel locks itself (30 s, doubling up to 15 min) |
| Session | Auto-logs out after **30 minutes** of inactivity (sliding — active use extends it) |
| Hidden from search engines | `admin.html` has `noindex` + `robots.txt` disallow |

**What you can manage**

- **Apps & Links** — for every app: APK link, EXE link, Web app link, PWA install link, version,
  release date, size, description, features, changelog, icon, accent colour,
  categories (where it appears), plus **add new apps** and delete apps.
  Includes the **⇪ Upload file** centre: pick an `.apk` / `.exe` / `.zip` file straight
  from your file manager (or drag & drop) and the panel **auto-detects everything** in a
  read-only INFO box — app **icon** (extracted from the APK), app **name**, **version code**,
  **version name**, **size**, **package name**, **ABIs** (arm64-v8a / armeabi-v7a …),
  **MD5** and **SHA-256** checksums and a **status** verdict — plus the platform
  (Android / Web / Windows EXE / PWA ticks). One click uploads it into your repository
  with a live progress bar and fills the download link, size, version and changelog for you.
  Detected package details (package name, version code, ABIs, SHA-256) are stored with the
  app and shown to visitors on the app page for verification before installing.
  "New version" mode keeps every old build in the repository — nothing is ever deleted.
- **Logo** — upload your own logo (auto-resized, transparency kept). Applies
  instantly everywhere including the favicon.
- **Settings** — contact email (used by the contact form), footer tagline,
  site-wide announcement strip.
- **Password** — change the admin password with a live strength meter.
- **Data / Publish** — **one-click publish to GitHub** + manual export & import of your whole setup.

---

## ⚡ One-click publish + auto-publish (the easy way)

The Admin Panel commits your data directly into your GitHub repository — no manual file
replacing, no git commands. After the first publish it can even publish **automatically**
whenever you save a change.

**One-time setup (~2 minutes, fully guided in the panel):**

1. Admin Panel → **Data / Publish**.
2. Create a GitHub token: *github.com → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token* → **Repository access: only your website repo** →
   **Permissions → Contents: Read and write** → everything else *No access*.
3. **Enter your GitHub token → press `Get`** — the panel detects your account and lists
   **ALL of your repositories** (public and private, auto-paginated). Pick **any** repository
   from the dropdown — branch, website files, data file and live URL are **auto-detected**;
   the connection is saved automatically. The panel shows the saved token's health right
   under the input (`Saved token is valid — @yourname`).
4. Check the auto-suggested **publish description** → press **⇪ Publish now — go live** once.
   From that moment **Auto-publish** switches on: every further save (apps, links, versions,
   logo, settings) is committed automatically within seconds — no button needed.
   You can switch it off any time.

**Publishing extras:**

- **⇪ Direct file uploads** — APK, EXE and web builds are uploaded from the Apps tab straight
  into your repository (`apps/<app-id>/…`). Files up to 16 MB go through the Contents API as
  one file. **Bigger files are split automatically into 16 MB parts**: every part is uploaded
  as its own Git blob (with per-part retries and a real 0–100 % progress bar), a small
  `.manifest.json` describes the parts, and ONE commit adds them all — GitHub's APIs refuse
  oversized single requests (422 "input was too large"), and Cloudflare Pages cannot serve
  files above ~25 MB, so multi-part is the only reliable route for big APK/EXE builds.
  Visitors download through the built-in **download manager**: a progress modal fetches the
  parts (3 at a time, automatic retries), verifies every part's SHA-256, reassembles the
  original file and saves it — fully on your own site, never on GitHub.
- **ANY repository works** — if the repo you pick does not contain the VORTEX website yet,
  the panel detects it and offers a one-click **⇪ Deploy the VORTEX website to this
  repository** (copies every page, style, script and icon over), so your data publish lands
  on a fully working site.
- **⚠ Public vs private repositories — what your visitors can actually see.** Publishing
  into a **private** repository succeeds technically, but visitors can NEVER see it:
  GitHub Pages on the free plan refuses to serve private repositories, and every file
  inside a private repo (including uploaded APKs) is locked behind your secret token, so
  downloads are impossible. **Users download from your live website, and your live website
  is built from the repository connected to GitHub Pages / Cloudflare Pages — always pick
  that PUBLIC repository in the dropdown.** The panel shows a 🔒 warning with one-click
  switch chips the moment a private repository is selected, blocks file uploads into a
  private repo that does not host the site, and explains it in every related error message.
  (Advanced: a private repo *can* still be served publicly through Cloudflare Pages or
  GitHub Pro — connect it in dash.cloudflare.com → Workers & Pages first.)
- **Publish description** — each commit carries a readable summary; the panel even
  auto-suggests one from your actual edits ("FLAREX KING v1.2.0 → v1.3.0 · added MyApp").
- **⇩ Pull latest from GitHub** — merge the currently published data into this browser
  (perfect when you edit from a different device). Safe union: newer edits win, your
  deletions stay deleted, nothing is ever lost.
- The **dashboard badge** shows whether you have unpublished changes — when it glows,
  publish (or let auto-publish do it) to go live.
- **Publish history** lists your last commits with links, and GitHub keeps every old version,
  so you can always roll back.

> 🔐 The token is stored **only in your own browser** (localStorage). It is never embedded in
> the website, never exported with backups, and you can revoke it from GitHub at any time.
> For maximum safety use a fine-grained token limited to this one repository.

**Troubleshooting — “Token invalid or expired (GitHub 401)”**

This message means GitHub no longer accepts the token **saved in this browser** — almost
always because the token was **regenerated or revoked on GitHub** (generating a new token
can invalidate the old one). The fix takes 20 seconds:

1. Copy your **new** token from *github.com → Settings → Developer settings → Tokens*.
2. Admin → **Data / Publish** → paste it into the token box → press **Get**.
3. Done — the chip under the box must show *Saved token is valid — @yourname*.

Uploads are **checked against GitHub before any byte is sent**, so a stale token now stops
the upload at 0 % with this exact explanation instead of failing after minutes at 90 %.

---

## 📤 How publishing works (technical background)

This is a **static** site — it cannot save data to a server. So changes work in two layers:

1. **Instant preview (your browser):** every change you make in the Admin Panel
   is saved in your browser's localStorage and is visible on the site immediately.
2. **Global publish (all visitors):** the **Publish now** button (or a manual
   "Export apps-data.js" + replace in repo) updates **`js/apps-data.js`** in your
   repository. Your host rebuilds and every visitor worldwide sees your apps,
   links, versions and logo.

> 💡 The published `apps-data.js` embeds **everything**: apps, links, versions,
> changelogs, your custom logo (as a data URL), site settings and your password
> hash (salted — never the plain password).

**Adding a new APK link — the exact flow:**

1. Admin → **Apps & Links** → open the app → **paste a URL** or press
   **⇪ Upload file** and pick your `.apk` — the panel reads the package automatically
   (icon, name, version code, size, package name, ABIs, MD5, SHA-256 — shown read-only)
   and the file is committed into your repo under `apps/<app-id>/` with the download link
   **set automatically**.
   Uploaded files are served from your own site, so the button downloads straight from
   Vortex. A pasted GitHub file link (`github.com/…/blob/…/app.apk`) is **auto-converted
   to a direct download link** — visitors **never land on GitHub** either way
   (this is re-checked at render time too).
2. Bump **Latest version** and add a changelog line
   (format: `1.3.0 | 2026-11-01 | What changed`). The panel reads the version from the
   filename (`myapp-v1.2.3.apk`) and warns if the two don't match.
3. Users who downloaded the old version automatically get the
   **"Update version available"** message and update with one click — inside Vortex.
4. Done — with auto-publish ON the change is already going live; otherwise press
   **Publish now — go live** on **Data / Publish**.

> The same flow covers **EXE** (Windows, same one-click upload), **Web apps** (open in
> browser) and **PWA** (install link) — four link types per app, all published in one go.

---

## 🛡 Safe-update promise (nothing gets deleted)

Follow these rules and you can update the website as often as you like without
losing any app, link or setting:

1. **`js/apps-data.js` is your data.** When you update website files (new version
   of pages, styles, etc.), never overwrite `js/apps-data.js` with an old copy —
   only the publish button or your own exports should change that file.
2. **Auto-backup before every publish.** The panel downloads
   `vortex-auto-backup-…json` before it touches GitHub. Keep these files —
   you can re-import any of them via *Data / Publish → Import JSON backup*.
3. **Merge-first overwrite protection.** If the file on GitHub contains apps that your
   browser does not have, the panel offers to **merge them in first and then publish** —
   apps published from another device can never be wiped by accident. Your own deletions
   are remembered (`deletedIds`) so a pull/merge will not resurrect apps you removed.
4. **Full-file publishes.** Every publish writes your **complete** data (all apps,
   logo, settings) — never a partial file that could drop something.
5. **GitHub keeps every version.** Each publish is a normal commit with a message
   like *"VORTEX admin publish (rev 7): FLAREX KING v1.2.0 → v1.3.0"* — open **Publish history**
   to view or roll back to any earlier state.
6. **Update other files freely.** `index.html`, `css/`, `js/main.js`, `js/pages.js`,
   images… can all be replaced when updating the site. Your published data lives
   only in `js/apps-data.js` and your admin token only in your own browser.

---

## 🧩 File structure

```
vortex-website/
├── index.html               ← home
├── marketplace.html         ← all apps + filters
├── apk.html                 ← Android APK downloads
├── pwa.html                 ← progressive web apps
├── webapps.html             ← web applications
├── updates.html             ← versions & changelogs
├── app.html                 ← universal app detail page (?id=…)
├── privacy.html · terms.html · contact.html
├── admin.html               ← 🔐 admin panel
├── 404.html
├── css/styles.css           ← the whole design system
├── js/apps-data.js          ← central data (export target)
├── js/main.js               ← core: data merge, logo, chrome, update banner
├── js/pages.js              ← page renderers
├── js/admin.js              ← admin: security, sessions, tabs
├── js/admin-data.js         ← admin: apps manager, export/import
├── js/admin-publish.js      ← admin: one-click publish to GitHub (Contents API)
├── js/admin-apk.js          ← admin: APK auto-detect (hashes, ABIs, manifest parser)
├── js/vendor/               ← vendored MIT library (app-info-parser) for APK metadata
├── icons/                   ← original app icons + PWA PNG icons
├── logo.svg · favicon.svg   ← default VORTEX brand mark (your uploaded artwork, emblem crop)
├── logo-full.png            ← full artwork with wordmark (homepage hero)
├── manifest.json            ← PWA manifest
├── robots.txt · .nojekyll
└── README.md
```

---

## ⚠️ Honest security notes (please read)

- Client-side password protection on a static site is **deterrence, not DRM**:
  a determined technical user can read the code. The panel's data is public
  website data — the panel exists so *you* can manage it conveniently and so
  casual visitors can't touch it.
- The real safety of your published content comes from **your GitHub
  repository permissions** — only you should be able to push.
- The default password is in this README on purpose: **change it before
  going live** and publish the exported `apps-data.js` so the change applies
  everywhere.
- No "verified" or fake trust claims are made anywhere on the site, and no
  download URLs were invented — links appear only after you publish them.

---

## 🎨 Customisation cheat-sheet

| What | Where |
|---|---|
| Colours / theme | `css/styles.css` → `:root` variables (`--accent`, `--bg-0`, …) |
| Fonts | Google Fonts link in each HTML file (Orbitron + Rajdhani) |
| Default logo | Already set to your uploaded artwork (`logo.svg` emblem + `logo-full.png` hero). To change it later: Admin Panel → Logo, or replace those files |
| PWA name/colours | `manifest.json` |

---

*All assets, texts, icons and code in this project are original works created
for VORTEX.*
