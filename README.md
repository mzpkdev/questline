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
- **Opt-in.** Enabling sync is a deliberate click and nothing uploads until you do; until then the
  roadmap lives only in this browser.

### Self-hosting

One Cloudflare Worker serves the app and the sync API together (via `@cloudflare/vite-plugin`),
storing encrypted blobs in KV. Create the namespace once, then deploy:

```sh
bunx wrangler kv namespace create QUESTLINE   # paste the id into wrangler.jsonc
bun run deploy
```

Sync defaults to same-origin, so no extra config is needed; `bun run preview` runs the same setup
locally.
