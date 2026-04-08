# GitHub Bookmarks

A minimal web app for saving and organizing GitHub repositories you want to reference later.

Paste any GitHub URL and it fetches the project's cover image, name, and description — displaying everything as a clean card grid. Bookmarks persist in your browser via localStorage, so your collection survives page refreshes.

## Features

- **Paste any GitHub URL** to add a repo — or use the `owner/repo` shorthand
- **Cover images** pulled automatically from GitHub's social preview
- **Smart category suggestions** — as you type a URL, the app fetches the repo and suggests categories based on its GitHub topics, language, and description
- **Categories** — assign repos to categories on add, or click the category chip on any card to edit it inline
- **Filter bar** — browse your collection by category
- **Remove bookmarks** — X button on each card
- **localStorage persistence** — your bookmarks are saved in the browser

## Usage

Open `index.html` directly in any browser. No build step or server required.

## Tech

Vanilla HTML, CSS, and JavaScript. Uses the [GitHub REST API](https://docs.github.com/en/rest) to fetch repository metadata.
