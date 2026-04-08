'use strict';

const STORAGE_KEY = 'gh-bookmarks';

// Language color map (subset of linguist colors)
const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5',
  Rust: '#dea584', Go: '#00ADD8', Java: '#b07219', 'C++': '#f34b7d',
  C: '#555555', 'C#': '#178600', Ruby: '#701516', PHP: '#4F5D95',
  Swift: '#F05138', Kotlin: '#A97BFF', Dart: '#00B4AB', Shell: '#89e051',
  HTML: '#e34c26', CSS: '#563d7c', Vue: '#41b883', Svelte: '#ff3e00',
  Elixir: '#6e4a7e', Haskell: '#5e5086', Scala: '#c22d40', Lua: '#000080',
  'Jupyter Notebook': '#DA5B0B', R: '#198CE7', MATLAB: '#e16737',
};

// ── DOM refs ────────────────────────────────────────────────────────────────
const input   = document.getElementById('url-input');
const addBtn  = document.getElementById('add-btn');
const errorEl = document.getElementById('error-msg');
const grid    = document.getElementById('grid');
const empty   = document.getElementById('empty-state');

// ── State ───────────────────────────────────────────────────────────────────
let bookmarks = loadBookmarks();

// ── Init ────────────────────────────────────────────────────────────────────
renderAll();

input.addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
addBtn.addEventListener('click', handleAdd);

// ── Handlers ─────────────────────────────────────────────────────────────────
async function handleAdd() {
  const raw = input.value.trim();
  if (!raw) return;

  const parsed = parseGitHubUrl(raw);
  if (!parsed) {
    showError('Please enter a valid GitHub repository URL.');
    return;
  }

  const { owner, repo } = parsed;
  const id = `${owner}/${repo}`.toLowerCase();

  if (bookmarks.find(b => b.id === id)) {
    showError(`${owner}/${repo} is already bookmarked.`);
    return;
  }

  clearError();
  setLoading(true);

  const skeletonCard = addSkeletonCard(id);

  try {
    const data = await fetchRepo(owner, repo);
    const bookmark = {
      id,
      owner: data.owner.login,
      repo: data.name,
      fullName: data.full_name,
      description: data.description || '',
      stars: data.stargazers_count,
      language: data.language || null,
      url: data.html_url,
      coverUrl: `https://opengraph.githubassets.com/1/${data.full_name}`,
      addedAt: Date.now(),
    };

    bookmarks.unshift(bookmark);
    saveBookmarks();
    input.value = '';

    // Replace skeleton with real card
    const realCard = createCard(bookmark);
    skeletonCard.replaceWith(realCard);
  } catch (err) {
    skeletonCard.remove();
    showError(err.message);
  } finally {
    setLoading(false);
    updateEmptyState();
  }
}

// ── Parse URL ────────────────────────────────────────────────────────────────
function parseGitHubUrl(url) {
  try {
    // Accept "owner/repo" shorthand
    if (!url.includes('://') && !url.startsWith('github.com')) {
      const parts = url.split('/').filter(Boolean);
      if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
    }
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (!u.hostname.includes('github.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

// ── GitHub API ───────────────────────────────────────────────────────────────
async function fetchRepo(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (res.status === 404) throw new Error(`Repository "${owner}/${repo}" not found.`);
  if (res.status === 403) throw new Error('GitHub API rate limit reached. Try again in a minute.');
  if (!res.ok) throw new Error(`GitHub API error (${res.status}).`);

  return res.json();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  grid.innerHTML = '';
  bookmarks.forEach(b => grid.appendChild(createCard(b)));
  updateEmptyState();
}

function createCard(bookmark) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = bookmark.id;

  const langColor = bookmark.language ? (LANG_COLORS[bookmark.language] || '#58a6ff') : null;

  card.innerHTML = `
    <button class="card-remove" title="Remove bookmark" aria-label="Remove ${bookmark.fullName}">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>
    <img
      class="card-cover"
      src="${bookmark.coverUrl}"
      alt="${bookmark.fullName} preview"
      loading="lazy"
      onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
    />
    <div class="card-cover-placeholder" style="display:none;">
      <svg height="48" viewBox="0 0 16 16" width="48" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38
          0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
          -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66
          .07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
          -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27
          .68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
          .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48
          0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
    </div>
    <div class="card-body">
      <a class="card-repo-name" href="${bookmark.url}" target="_blank" rel="noopener noreferrer">
        ${escHtml(bookmark.fullName)}
      </a>
      ${bookmark.description
        ? `<p class="card-description">${escHtml(bookmark.description)}</p>`
        : `<p class="card-description" style="font-style:italic;opacity:0.5">No description provided.</p>`}
      <div class="card-meta">
        ${langColor ? `
          <span class="meta-item">
            <span class="lang-dot" style="background:${langColor}"></span>
            ${escHtml(bookmark.language)}
          </span>` : ''}
        <span class="meta-item">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416
              1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75
              0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75
              0 018 .25z"/>
          </svg>
          ${formatNumber(bookmark.stars)}
        </span>
      </div>
    </div>
  `;

  card.querySelector('.card-remove').addEventListener('click', () => removeBookmark(bookmark.id));

  return card;
}

function addSkeletonCard(id) {
  const card = document.createElement('div');
  card.className = 'card skeleton';
  card.dataset.id = id;
  card.innerHTML = `
    <div class="card-cover" style="aspect-ratio:2/1"></div>
    <div class="card-body" style="gap:10px">
      <div class="skeleton-line short"></div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-line medium"></div>
    </div>
  `;
  grid.prepend(card);
  updateEmptyState();
  return card;
}

function removeBookmark(id) {
  bookmarks = bookmarks.filter(b => b.id !== id);
  saveBookmarks();
  const el = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (el) {
    el.style.transition = 'opacity 0.2s, transform 0.2s';
    el.style.opacity = '0';
    el.style.transform = 'scale(0.95)';
    setTimeout(() => { el.remove(); updateEmptyState(); }, 200);
  }
}

function updateEmptyState() {
  const hasCards = grid.children.length > 0;
  empty.classList.toggle('hidden', hasCards);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function clearError() {
  errorEl.textContent = '';
  errorEl.classList.add('hidden');
}

function setLoading(on) {
  addBtn.disabled = on;
  addBtn.textContent = on ? 'Adding…' : 'Add';
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return n.toString();
}

// ── Persistence ───────────────────────────────────────────────────────────────
function loadBookmarks() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveBookmarks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}
