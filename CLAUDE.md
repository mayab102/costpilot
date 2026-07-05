# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CostPilot is a Hebrew (RTL) construction-project cost-management web app for BDO-opex. It tracks projects, consultant quotes, milestones, invoices, budgets, tender results, and supplier ratings.

The **entire frontend is one file: `index.html`** (~670 KB). There is no build step, no bundler, and no npm packages for the frontend. React 18 (UMD) plus `babel-standalone` transpile JSX in the browser at runtime. All libraries load from CDNs (React, ReactDOM, Babel, `xlsx-js-style`, jsPDF, html2canvas, mammoth, Firebase v10 ES modules).

## Commands

There is no frontend build or test runner. You edit `index.html` directly.

- **Run locally:** open `index.html` in a browser (it talks to the live Firebase project). Manual QA only — `qa-checklist.md` is the canonical checklist of behaviors to verify.
- **Deploy frontend:** push to `main`. `.github/workflows/deploy.yml` publishes the repo root to GitHub Pages (live at `bdo-opex.github.io/costpilot`). The deployed `index.html` *is* production.
- **Cloud Functions** (`functions/`, Node 18):
  - `cd functions && npm install`
  - `npm run serve` — `firebase emulators:start --only functions`
  - `npm run deploy` — `firebase deploy --only functions`
- **Firestore rules:** `firebase deploy --only firestore:rules` (rules live in `firestore.rules`).

## Architecture

### Frontend (`index.html`)

Three `<script>` blocks in `<head>`:
1. CDN library tags.
2. A `type="module"` block that initializes Firebase (Auth + Firestore) and exposes everything on `window._firebase`. Firebase config is inline here.
3. The `type="text/babel"` block — the whole app. Access Firebase via `const { ... } = getFirebase()` (reads `window._firebase`).

Component tree (all functions in the babel block): `App` → `AppInner` (`~line 8353`, holds all top-level state and Firestore sync) → tab components. The 8 tabs are defined in the `TABS` array (`~line 761`): `opening`, `quotes`, `consultants`, `accounts`, `budget`, `tender`, `contractor`, `ratings`.

### Data model (Firestore)

Every app entity is stored as a **single document holding a JSON string in a `value` field** (`setDoc(doc(db,"shared",key), { value: JSON.stringify(data) })`).

- `shared/{key}` — global blobs. `SHARED_KEYS` = `projects`, `allData` (legacy), `suppliers`, `companies`, `milestones`, `statsRows`, `workScopes`, `managers`.
- `shared/proj_{id}` — **per-project data** (shape from `makeProjectData()`: `quotes`, `consultants`, `accounts`, `budget`, `budgetState`, `tender`, `contractor`). This replaced the old single `shared/allData` blob; `AppInner` migrates legacy `allData[id]` into `proj_{id}` on first load.
- `userRoles/{uid}` — `{ role: "admin" | "user", projects: [...] }`.
- `notifications/{id}` — written **only by Cloud Functions** (admin SDK); the client just reads.

Sync is real-time via `onSnapshot` subscriptions (`subscribeShared`, `subscribeProjectData`). The `fsReceived` ref guards against write-back echo loops. `syncProjectData()` reconciles derived state (e.g. ensures approved quote consultants appear in the consultants array).

### Permissions

`isAdmin` is derived from `userRole.role`. Admins can write everything and see all projects; regular users are **read-only** (enforced both by Firestore rules and the `.view-only` CSS class) and see only projects listed in their `userRoles.projects`.

### Cloud Functions (`functions/index.js`)

Sends Hebrew emails via nodemailer over Outlook/Office 365 SMTP. Credentials come from env vars `OUTLOOK_USER` / `OUTLOOK_PASSWORD`.
- `onNotificationCreated` — emails immediately when a `notifications` doc is created.
- `sendReminders` — scheduled every 6 hours; re-emails unresolved notifications older than 3 days.

## Conventions that matter

- **Name matching / normalization (~lines 789–843).** Imported project data has inconsistent supplier and profession names plus hidden Unicode characters. Use the existing helpers rather than comparing strings directly: `_normSupName`, `namesEquivalent` / `canonicalSupplierName` (suppliers), `professionEquivalent`, `findMilestoneTemplate`, `profStatPct` (professions/fields). Prefer fixing such mismatches by normalizing at the data layer, not by patching individual consumers.
- **RTL + Hebrew** throughout. UI strings, comments, and labels are Hebrew. Keep RTL correctness in mind for any layout change.
- **Design tokens** live in the CSS `:root` block (`~line 707`) — navy/teal palette, Heebo font, IBM Plex Mono for numerics (`.mono`). Reuse the tokens.
- Currency/number formatting goes through `fmt()`; dates through `fmtDate` / `toInputDate` (ISO `yyyy-mm-dd` stored, `dd/mm/yyyy` displayed).
