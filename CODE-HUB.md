# Vortex Ecosystem — Code Hub (self-hosted git)

The whole ecosystem's code (CloudAgent + VORTEX_SERVER + scripts) lives in this
repo. It is served by the platform itself — no GitHub, no Cloudflare, no third
party anywhere.

## Clone from any editor (VS Code, terminal, anything that speaks git)

    git clone http://localhost:3000/api/ecosystem-git/vortex-ecosystem.git
    Username: anything (e.g. vortex)
    Password: an ecosystem token (create it in Admin > Code Hub > Git access tokens)

## Push = auto deploy

Every `git push` triggers the pipeline automatically:

    checkout -> deps (only if manifests changed) -> VORTEX build (only if its
    code changed) -> restart :3200

CloudAgent (:3000) edits go live instantly via dev/HMR. Track progress in
**Admin > Code Hub > Push to live deploy** (status + history + manual redeploy).

## Data safety

`db/`, `projects/`, `upload/`, `download/`, `.env`, tokens — never touched by
any push or deploy. Runtime data survives every commit.
