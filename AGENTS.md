# AGENTS.md

- Gates (all must pass): `npx tsc --noEmit && node --test src/game/ && npm run build && node scripts/measure-look.mjs`
- After editing any `src/game/*.test.ts`, run `bash scripts/build-tests.sh` (regenerates the committed `*.test.js` + `index.js`).
- `src/game/**` must not import `three`. Layout numbers live only in `src/game/cabin.ts` / `src/game/space.ts`.
- e2e: `node e2e/smoke.mjs`. `SEER_FAST=1 node scripts/measure-look.mjs` shoots landscape only (quicker iteration).
- Deploy: `bash scripts/ci-deploy.sh` (pm2 `seer-observatory`, port 3029, base `/seer/`).
- Headless Chromium on WSL needs the SwiftShader flags and `waitUntil: 'commit'` + frame polling (see measure-look).
