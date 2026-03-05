# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

LearnPress Offline is an Electron desktop app for offline learning backed by a WordPress/LearnPress LMS. It uses SQLite (via `better-sqlite3`), Axios, Electron v27, and Mocha/Chai/Sinon for tests. See `README.md` and `ONTRIBUTING.md` for full details.

### Node.js version

This project requires **Node.js v18** (set via `nvm alias default 18`). Node.js v22+ breaks the `better-sqlite3@^8.7.0` native build. The `engines` field says `>=16` but v18 LTS is the latest compatible version.

### Native module rebuild caveat

After `npm install`, the `postinstall` script rebuilds `better-sqlite3` for **Electron** (via `electron-rebuild`). This means the native module won't work under plain Node.js (needed by `npm test`). To run tests, first run:

```bash
npm rebuild better-sqlite3
```

To restore the Electron-compatible build (needed by `npm run dev`), run:

```bash
npx electron-rebuild -f -w better-sqlite3
```

### Running the app (headless Linux)

The Electron app requires a display server. On headless Linux (like this VM), use:

```bash
xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24" npx cross-env NODE_ENV=development electron .
```

### Key commands

| Task | Command |
|---|---|
| Install deps | `npm install` |
| Dev setup | `npm run dev-setup` |
| Lint | `npx eslint src/**/*.js lib/**/*.js main.js preload.js` |
| Tests | `npm rebuild better-sqlite3 && npm test` |
| Run app (headless) | `xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24" npx cross-env NODE_ENV=development electron .` |

### Pre-existing test failures

The test suite (as of this writing) has pre-existing failures: most tests try to reach `test.com` without proper mocking, and some assertions are incorrect. Only ~1 out of 11 tests pass. This is a codebase issue, not an environment issue.

### .env file

The `.env` file may be corrupted on fresh clones (contains `.\node_modules\`). Copy from `.env.example` and run `npm run generate-key` to set up the encryption key. Alternatively, `npm run dev-setup` handles this.
