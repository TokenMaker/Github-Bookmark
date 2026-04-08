# GitHub Bookmarks

A minimal web app for saving and organizing GitHub repositories you want to reference later. Paste any GitHub URL and it fetches the project's cover image, name, description, and stats — displayed as a clean card grid.

Bookmarks are stored in your browser locally and can be synced across devices via a private GitHub Gist.

**[Live Demo →](https://github-bookmark.vercel.app)**

---

## Features

- Paste any GitHub URL to add a repo (or use `owner/repo` shorthand)
- Cover images pulled automatically from GitHub's social preview
- Smart category suggestions based on repo topics, language, and description
- Click the category chip on any card to edit it inline
- Filter bar to browse by category
- Real-time search across name, description, language, and topics
- Sort by Date Added, A → Z, or Most Stars
- Remove bookmarks with the ✕ button on each card
- Export bookmarks as a JSON file
- Import a JSON file to restore or merge bookmarks
- **Sync across devices** via a private GitHub Gist

---

## Getting Started

The app runs entirely in the browser — no install, no server, no account required to use locally.

Just open `index.html` in any browser, or visit the live deployment.

---

## Cross-Device Sync

Bookmarks sync across devices using a **private GitHub Gist**. Your bookmarks are stored in your own GitHub account — no one else can see them.

### Step 1 — Create a Personal Access Token

1. Go to [github.com](https://github.com) and sign in
2. Click your avatar → **Settings**
3. Scroll down to **Developer settings** (bottom of the left sidebar)
4. Go to **Personal access tokens → Tokens (classic)**
5. Click **Generate new token (classic)**
6. Give it a name like `GitHub Bookmarks`
7. Under **Scopes**, check only **`gist`** — nothing else is needed
8. Click **Generate token** and copy it (you won't see it again)

### Step 2 — Connect the app

1. Open the app and click **⇅ SYNC** in the toolbar
2. Paste your token into the **Personal Access Token** field
3. Click **↑ Save to Gist** — this creates a new private Gist in your account and saves your bookmarks to it
4. The Gist ID is saved automatically

### Step 3 — Sync on another device

1. Open the app on your phone or another browser
2. Click **⇅ SYNC**
3. Paste the same token
4. Click **↓ Load from Gist** — your full bookmark collection loads instantly

After setup, the app **auto-syncs in the background** every time you add, remove, or recategorize a bookmark.

---

## Export & Import

If you prefer not to use Gist sync, you can move bookmarks manually:

- **↓ EXPORT** — downloads a `github-bookmarks.json` file with all your bookmarks
- **↑ IMPORT** — pick a JSON file to merge bookmarks in (duplicates are skipped)

---

## Tech

Vanilla HTML, CSS, and JavaScript. No frameworks, no build step.

Uses the [GitHub REST API](https://docs.github.com/en/rest) to fetch repository metadata and the [GitHub Gist API](https://docs.github.com/en/rest/gists) for sync.
