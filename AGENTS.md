# AGENTS.md

## Cursor Cloud specific instructions

This is an Electron v27 desktop application (LearnPress Offline) that requires **Node.js 18** (set via `nvm use 18`). Node.js 22+ is incompatible with the `better-sqlite3@^8.7.0` native module used by this project.

### Running the app

- **Dev mode:** `DISPLAY=:99 NODE_ENV=development npx electron . --no-sandbox` (requires Xvfb on `:99`; start with `Xvfb :99 -screen 0 1280x1024x24 &`)
- The app entry point is `main.js`. On launch it shows a login form (WordPress URL + credentials). No WordPress backend is needed to start the app; it will show the login screen in offline mode.
- DevTools open automatically in development mode.

### Lint, test, build

- **Lint:** `npx eslint src/**/*.js lib/**/*.js main.js preload.js` — pre-existing lint errors exist in the codebase (8700+); this is not caused by environment issues.
- **Tests:** `npx mocha tests/**/*.test.js --timeout 10000` — most tests have pre-existing failures due to test stubs not matching the API client retry logic and missing mock properties. The test framework itself (Mocha/Chai/Sinon) works correctly.
- **Build:** `npm run build-linux` (not typically needed in dev)
- See `package.json` scripts for the full list.

### Native module gotcha

The `postinstall` script rebuilds `better-sqlite3` for **Electron**. If you need to run tests under system Node.js, run `npm rebuild better-sqlite3` first. To switch back for Electron: `npx electron-rebuild -f -w better-sqlite3`.

### WordPress backend

The app communicates with a WordPress site that has the LearnPress plugin and the COL LMS Offline API plugin (in `wordpress-plugin/`). No WordPress backend is provisioned in this environment, so login-dependent features cannot be tested end-to-end. The app starts and displays its UI without a backend.
