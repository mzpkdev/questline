<p align="center">
  <img src=".github/assets/banner.svg" alt="Questline" width="440">
</p>

## Sync across devices (optional)

Questline stays account-free. To keep the same roadmap on your laptop and phone, turn on **sync**: it
mints a private link, and opening that link on another device keeps the two in step.

- **End-to-end encrypted.** The link carries a secret key that never leaves your devices; the server
  only ever stores ciphertext it can't read.
- **The link is the key.** Anyone who holds it can read and edit your roadmap, and losing it means the
  data can't be recovered. Treat it like a password.
- **Off by default.** With no Worker configured (`VITE_SYNC_URL` unset), the app is fully local and
  your data lives only in this browser.

### Self-hosting the sync Worker

Sync is backed by a small Cloudflare Worker (`worker/`) that stores encrypted blobs in KV:

```sh
cd worker
bunx wrangler kv namespace create QUESTLINE   # paste the id into wrangler.jsonc
bunx wrangler deploy
```

Set `ALLOWED_ORIGIN` in `worker/wrangler.jsonc` to your site's origin, then point the app at the
deployed Worker with `VITE_SYNC_URL` (a repo variable for the GitHub Pages build, or `.env.local`
for local dev). See `.env.example`.
