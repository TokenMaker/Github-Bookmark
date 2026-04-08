'use strict';

const STORAGE_KEY     = 'gh-bookmarks';
const SYNC_TOKEN_KEY  = 'gh-bm-token';
const SYNC_GIST_KEY   = 'gh-bm-gist-id';
const GIST_FILENAME   = 'github-bookmarks.json';
const DEFAULT_CAT     = 'Uncategorized';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const input            = document.getElementById('url-input');
const categoryInput    = document.getElementById('category-input');
const categorySuggest  = document.getElementById('category-suggestions');
const suggestionsEl    = document.getElementById('suggestions');
const addBtn           = document.getElementById('add-btn');
const errorEl          = document.getElementById('error-msg');
const grid             = document.getElementById('grid');
const empty            = document.getElementById('empty-state');
const footerCount      = document.getElementById('footer-count');
const filterBar        = document.getElementById('filter-bar');
const filterBarInner   = filterBar.querySelector('.filter-bar-inner');
const toolbar          = document.getElementById('toolbar');
const searchInput      = document.getElementById('search-input');
const searchClear      = document.getElementById('search-clear');
const searchCount      = document.getElementById('search-result-count');
const sortSelect       = document.getElementById('sort-select');
const syncStatusBar    = document.getElementById('sync-status-bar');
const syncStatusText   = document.getElementById('sync-status-text');
// Toolbar buttons
const syncBtn          = document.getElementById('sync-btn');
const exportBtn        = document.getElementById('export-btn');
const importFile       = document.getElementById('import-file');
// Modal
const syncModal        = document.getElementById('sync-modal');
const modalClose       = document.getElementById('modal-close');
const tokenInput       = document.getElementById('token-input');
const tokenToggle      = document.getElementById('token-toggle');
const gistIdInput      = document.getElementById('gist-id-input');
const syncModalStatus  = document.getElementById('sync-modal-status');
const pushBtn          = document.getElementById('push-btn');
const pullBtn          = document.getElementById('pull-btn');
const disconnectBtn    = document.getElementById('disconnect-btn');

// ── State ─────────────────────────────────────────────────────────────────────
let bookmarks      = loadBookmarks();
let activeCategory = '__all__';
let searchQuery    = '';
let sortOrder      = 'date';
let urlDebounce    = null;
let searchDebounce = null;

// ── Init ──────────────────────────────────────────────────────────────────────
renderAll();
renderFilterBar();
updateCategorySuggestions();
initSyncUI();

// If token + gist already configured, auto-pull on load
if (localStorage.getItem(SYNC_TOKEN_KEY) && localStorage.getItem(SYNC_GIST_KEY)) {
  autoPullOnLoad();
}

// ── Event listeners ───────────────────────────────────────────────────────────
input.addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
categoryInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
addBtn.addEventListener('click', handleAdd);

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = searchInput.value.trim().toLowerCase();
    searchClear.classList.toggle('hidden', !searchQuery);
    renderAll();
  }, 150);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.classList.add('hidden');
  searchInput.focus();
  renderAll();
});

sortSelect.addEventListener('change', () => {
  sortOrder = sortSelect.value;
  renderAll();
});

// URL suggestions
input.addEventListener('input', () => {
  clearTimeout(urlDebounce);
  const raw = input.value.trim();
  const parsed = raw ? parseGitHubUrl(raw) : null;
  if (!parsed) { hideSuggestions(); return; }
  urlDebounce = setTimeout(() => fetchSuggestions(parsed.owner, parsed.repo), 600);
});

// Export / Import
exportBtn.addEventListener('click', exportJSON);
importFile.addEventListener('change', importJSON);

// Sync modal
syncBtn.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
syncModal.addEventListener('click', e => { if (e.target === syncModal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

tokenToggle.addEventListener('click', () => {
  const show = tokenInput.type === 'password';
  tokenInput.type = show ? 'text' : 'password';
  tokenToggle.textContent = show ? 'HIDE' : 'SHOW';
});

pushBtn.addEventListener('click', pushToGist);
pullBtn.addEventListener('click', pullFromGist);
disconnectBtn.addEventListener('click', disconnect);

// ── Add ───────────────────────────────────────────────────────────────────────
async function handleAdd() {
  const raw = input.value.trim();
  if (!raw) return;

  const parsed = parseGitHubUrl(raw);
  if (!parsed) { showError('Please enter a valid GitHub repository URL.'); return; }

  const { owner, repo } = parsed;
  const id = `${owner}/${repo}`.toLowerCase();

  if (bookmarks.find(b => b.id === id)) {
    showError(`${owner}/${repo} is already bookmarked.`);
    return;
  }

  const category = categoryInput.value.trim() || DEFAULT_CAT;

  clearError();
  hideSuggestions();
  setLoading(true);

  if (activeCategory !== '__all__' && activeCategory !== category) {
    setActiveCategory('__all__');
  }

  const skeletonCard = addSkeletonCard(id);

  try {
    const data = await fetchRepo(owner, repo);
    const bookmark = {
      id,
      owner:       data.owner.login,
      repo:        data.name,
      fullName:    data.full_name,
      description: data.description || '',
      stars:       data.stargazers_count,
      language:    data.language || null,
      topics:      data.topics || [],
      url:         data.html_url,
      coverUrl:    `https://opengraph.githubassets.com/1/${data.full_name}`,
      category,
      addedAt:     Date.now(),
    };

    bookmarks.unshift(bookmark);
    saveBookmarks();
    input.value = '';
    categoryInput.value = '';

    const realCard = createCard(bookmark);
    skeletonCard.replaceWith(realCard);
    renderFilterBar();
    updateCategorySuggestions();

    // Auto-push if sync configured
    if (localStorage.getItem(SYNC_TOKEN_KEY) && localStorage.getItem(SYNC_GIST_KEY)) {
      silentPush();
    }
  } catch (err) {
    skeletonCard.remove();
    showError(err.message);
  } finally {
    setLoading(false);
    updateEmptyState();
  }
}

// ── Parse URL ─────────────────────────────────────────────────────────────────
function parseGitHubUrl(url) {
  try {
    if (!url.includes('://') && !url.startsWith('github.com')) {
      const parts = url.split('/').filter(Boolean);
      if (parts.length === 2) return { owner: parts[0], repo: parts[1] };
    }
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    if (!u.hostname.includes('github.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch { return null; }
}

// ── GitHub API ────────────────────────────────────────────────────────────────
async function fetchRepo(owner, repo) {
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    { headers: { Accept: 'application/vnd.github+json' } }
  );
  if (res.status === 404) throw new Error(`Repository "${owner}/${repo}" not found.`);
  if (res.status === 403) throw new Error('GitHub API rate limit reached. Try again in a minute.');
  if (!res.ok)            throw new Error(`GitHub API error (${res.status}).`);
  return res.json();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
  grid.innerHTML = '';

  let pool = activeCategory === '__all__'
    ? bookmarks
    : bookmarks.filter(b => (b.category || DEFAULT_CAT) === activeCategory);

  if (searchQuery) {
    pool = pool.filter(b =>
      b.fullName.toLowerCase().includes(searchQuery) ||
      (b.description || '').toLowerCase().includes(searchQuery) ||
      (b.language    || '').toLowerCase().includes(searchQuery) ||
      (b.category    || '').toLowerCase().includes(searchQuery) ||
      (b.topics      || []).some(t => t.toLowerCase().includes(searchQuery))
    );
  }

  pool = [...pool].sort((a, b) => {
    if (sortOrder === 'alpha') return a.fullName.localeCompare(b.fullName);
    if (sortOrder === 'stars') return (b.stars || 0) - (a.stars || 0);
    return b.addedAt - a.addedAt;
  });

  if (searchQuery) {
    searchCount.textContent = pool.length === 0
      ? `No results for "${searchInput.value.trim()}"`
      : `${pool.length} result${pool.length === 1 ? '' : 's'} for "${searchInput.value.trim()}"`;
    searchCount.classList.remove('hidden');
  } else {
    searchCount.classList.add('hidden');
  }

  if (pool.length === 0) { updateEmptyState(); return; }

  const groups = new Map();
  for (const b of pool) {
    const cat = b.category || DEFAULT_CAT;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(b);
  }

  const showHeaders = !searchQuery && activeCategory === '__all__' && groups.size > 1;

  for (const [cat, items] of groups) {
    if (showHeaders) {
      const header = document.createElement('div');
      header.className = 'category-header';
      header.innerHTML = `
        <span class="category-header-name">${escHtml(cat)}</span>
        <span class="category-header-count">${items.length} repo${items.length === 1 ? '' : 's'}</span>
      `;
      grid.appendChild(header);
    }
    items.forEach(b => grid.appendChild(createCard(b)));
  }

  updateEmptyState();
}

function createCard(bookmark) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.id = bookmark.id;

  const cat = bookmark.category || DEFAULT_CAT;

  card.innerHTML = `
    <button class="card-remove" title="Remove bookmark" aria-label="Remove ${escHtml(bookmark.fullName)}">✕</button>
    <img
      class="card-cover"
      src="${bookmark.coverUrl}"
      alt="${escHtml(bookmark.fullName)} preview"
      loading="lazy"
      onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
    />
    <div class="card-cover-placeholder" style="display:none;">
      <svg height="40" viewBox="0 0 16 16" width="40" fill="currentColor">
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
        : `<p class="card-description" style="font-style:italic;">No description provided.</p>`}
      <div class="card-meta">
        ${bookmark.language ? `<span class="meta-item"><span class="lang-dot"></span>${escHtml(bookmark.language)}</span>` : ''}
        <span class="meta-item">★ ${formatNumber(bookmark.stars)}</span>
        <span class="meta-item meta-item--category" title="Click to edit category" role="button" tabindex="0">
          ${escHtml(cat)}
        </span>
      </div>
    </div>
  `;

  card.querySelector('.card-remove').addEventListener('click', () => removeBookmark(bookmark.id));

  const catChip = card.querySelector('.meta-item--category');
  const startEdit = () => editCategory(card, catChip, bookmark);
  catChip.addEventListener('click', startEdit);
  catChip.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(); }
  });

  return card;
}

// ── Inline category edit ──────────────────────────────────────────────────────
function editCategory(card, chip, bookmark) {
  const current = bookmark.category || DEFAULT_CAT;

  let datalist = document.getElementById('inline-cat-list');
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = 'inline-cat-list';
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = getCategories().map(c => `<option value="${escHtml(c)}">`).join('');

  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'category-inline-edit';
  inp.value = current;
  inp.setAttribute('list', 'inline-cat-list');
  inp.setAttribute('aria-label', 'Edit category');

  chip.replaceWith(inp);
  inp.focus();
  inp.select();

  const commit = () => {
    const val = inp.value.trim() || DEFAULT_CAT;
    bookmark.category = val;
    saveBookmarks();

    const newChip = document.createElement('span');
    newChip.className = 'meta-item meta-item--category';
    newChip.title = 'Click to edit category';
    newChip.setAttribute('role', 'button');
    newChip.tabIndex = 0;
    newChip.textContent = val;
    inp.replaceWith(newChip);

    const startEdit = () => editCategory(card, newChip, bookmark);
    newChip.addEventListener('click', startEdit);
    newChip.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(); }
    });

    renderFilterBar();
    updateCategorySuggestions();
    if (activeCategory !== '__all__' && val !== activeCategory) renderAll();

    if (localStorage.getItem(SYNC_TOKEN_KEY) && localStorage.getItem(SYNC_GIST_KEY)) silentPush();
  };

  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { inp.value = current; inp.blur(); }
  });
}

// ── Skeleton ──────────────────────────────────────────────────────────────────
function addSkeletonCard(id) {
  const card = document.createElement('div');
  card.className = 'card skeleton';
  card.dataset.id = id;
  card.innerHTML = `
    <div class="card-cover" style="aspect-ratio:2/1;display:block;"></div>
    <div class="card-body" style="gap:12px;">
      <div class="skeleton-line short"></div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-line medium"></div>
    </div>
  `;
  grid.prepend(card);
  updateEmptyState();
  return card;
}

// ── Remove ────────────────────────────────────────────────────────────────────
function removeBookmark(id) {
  bookmarks = bookmarks.filter(b => b.id !== id);
  saveBookmarks();

  const el = grid.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (el) {
    el.style.transition = 'opacity 0.1s';
    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      grid.querySelectorAll('.category-header').forEach(h => {
        const next = h.nextElementSibling;
        if (!next || next.classList.contains('category-header')) h.remove();
      });
      renderFilterBar();
      updateCategorySuggestions();
      updateEmptyState();
    }, 120);
  }

  if (localStorage.getItem(SYNC_TOKEN_KEY) && localStorage.getItem(SYNC_GIST_KEY)) silentPush();
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function renderFilterBar() {
  const hasBookmarks = bookmarks.length > 0;
  filterBar.classList.toggle('hidden', !hasBookmarks);
  toolbar.classList.toggle('hidden', !hasBookmarks);

  filterBarInner.innerHTML = '';
  if (!hasBookmarks) return;

  filterBarInner.appendChild(makeTab('ALL', '__all__'));
  getCategories().forEach(cat => {
    const count = bookmarks.filter(b => (b.category || DEFAULT_CAT) === cat).length;
    filterBarInner.appendChild(makeTab(`${cat} (${count})`, cat));
  });
}

function makeTab(label, value) {
  const btn = document.createElement('button');
  btn.className = 'filter-tab' + (activeCategory === value ? ' active' : '');
  btn.dataset.category = value;
  btn.textContent = label;
  btn.addEventListener('click', () => setActiveCategory(value));
  return btn;
}

function setActiveCategory(cat) {
  activeCategory = cat;
  renderAll();
  renderFilterBar();
}

function getCategories() {
  const seen = new Set();
  bookmarks.forEach(b => seen.add(b.category || DEFAULT_CAT));
  return [...seen].sort((a, b) => a.localeCompare(b));
}

function updateCategorySuggestions() {
  if (!categorySuggest) return;
  categorySuggest.innerHTML = getCategories().map(c => `<option value="${escHtml(c)}">`).join('');
}

// ── Smart category suggestions ────────────────────────────────────────────────
async function fetchSuggestions(owner, repo) {
  try {
    const data = await fetchRepo(owner, repo);
    renderSuggestions(buildSuggestions(data));
  } catch { hideSuggestions(); }
}

function buildSuggestions(data) {
  const candidates = new Set();
  (data.topics || []).forEach(t => candidates.add(toTitleCase(t.replace(/-/g, ' '))));
  if (data.language) candidates.add(data.language);

  const text = `${data.name} ${data.description || ''}`.toLowerCase();
  const KEYWORD_MAP = [
    [/\b(ai|llm|gpt|machine.?learning|deep.?learning|neural|nlp|diffusion|langchain|openai|anthropic|hugging.?face)\b/, 'AI'],
    [/\b(react|vue|angular|svelte|next\.?js|nuxt|remix|frontend|ui.?library|component)\b/, 'Frontend'],
    [/\b(api|backend|server|express|fastapi|django|rails|rest|graphql|grpc|microservice)\b/, 'Backend'],
    [/\b(cli|terminal|shell|command.?line|tui)\b/, 'CLI Tools'],
    [/\b(docker|kubernetes|k8s|terraform|ansible|devops|infra|helm|cicd)\b/, 'DevOps'],
    [/\b(ios|android|flutter|react.?native|mobile|swift|kotlin)\b/, 'Mobile'],
    [/\b(database|sql|postgres|mysql|mongo|redis|sqlite|orm|prisma)\b/, 'Database'],
    [/\b(security|auth|crypto|jwt|oauth|vulnerability|pentest|encryption)\b/, 'Security'],
    [/\b(game|unity|godot|opengl|vulkan|pygame|phaser)\b/, 'Games'],
    [/\b(data|analytics|visualization|pandas|numpy|spark|etl|pipeline)\b/, 'Data'],
    [/\b(testing|test|jest|pytest|cypress|playwright|e2e)\b/, 'Testing'],
    [/\b(design|figma|css|sass|tailwind|typography|icon)\b/, 'Design'],
    [/\b(blockchain|web3|solidity|ethereum|nft|defi)\b/, 'Web3'],
  ];
  KEYWORD_MAP.forEach(([re, label]) => { if (re.test(text)) candidates.add(label); });
  getCategories().filter(c => c !== DEFAULT_CAT).slice(0, 3).forEach(c => candidates.add(c));
  return [...candidates].slice(0, 8);
}

function renderSuggestions(chips) {
  if (!chips.length) { hideSuggestions(); return; }
  suggestionsEl.innerHTML = `<span class="suggestions-label">Suggest:</span>` +
    chips.map(c => `<button class="suggestion-chip" type="button">${escHtml(c)}</button>`).join('');
  suggestionsEl.querySelectorAll('.suggestion-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      categoryInput.value = btn.textContent;
      hideSuggestions();
      categoryInput.focus();
    });
  });
  suggestionsEl.classList.remove('hidden');
}

function hideSuggestions() {
  suggestionsEl.classList.add('hidden');
  suggestionsEl.innerHTML = '';
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportJSON() {
  const blob = new Blob([JSON.stringify(bookmarks, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'github-bookmarks.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import ────────────────────────────────────────────────────────────────────
function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const imported = JSON.parse(evt.target.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');

      // Merge: keep existing, add new ones
      const existingIds = new Set(bookmarks.map(b => b.id));
      const newOnes = imported.filter(b => b.id && !existingIds.has(b.id))
        .map(b => ({ category: DEFAULT_CAT, topics: [], ...b }));

      bookmarks = [...newOnes, ...bookmarks];
      saveBookmarks();
      renderAll();
      renderFilterBar();
      updateCategorySuggestions();
      setSyncStatus('ok', `Imported ${newOnes.length} new bookmark${newOnes.length === 1 ? '' : 's'}.`);
    } catch {
      setSyncStatus('error', 'Import failed — invalid JSON file.');
    }
    importFile.value = '';
  };
  reader.readAsText(file);
}

// ── Gist Sync ─────────────────────────────────────────────────────────────────
function initSyncUI() {
  const token  = localStorage.getItem(SYNC_TOKEN_KEY) || '';
  const gistId = localStorage.getItem(SYNC_GIST_KEY)  || '';
  tokenInput.value  = token;
  gistIdInput.value = gistId;
  if (token && gistId) setSyncStatus('ok', `Synced via Gist · ${gistId.slice(0, 8)}…`);
}

async function autoPullOnLoad() {
  try {
    const pulled = await gistFetch();
    if (pulled) mergeFromGist(pulled);
  } catch { /* silent — don't disrupt page load */ }
}

async function pushToGist() {
  const token = tokenInput.value.trim();
  if (!token) { setModalStatus('error', 'Please enter a Personal Access Token.'); return; }

  setModalStatus('busy', 'Saving to Gist…');
  setBtnsDisabled(true);

  try {
    const gistId = gistIdInput.value.trim() || localStorage.getItem(SYNC_GIST_KEY) || '';
    const body   = JSON.stringify(bookmarks, null, 2);
    let res, data;

    if (gistId) {
      // Update existing gist
      res = await fetch(`https://api.github.com/gists/${gistId}`, {
        method:  'PATCH',
        headers: gistHeaders(token),
        body:    JSON.stringify({ files: { [GIST_FILENAME]: { content: body } } }),
      });
    } else {
      // Create new private gist
      res = await fetch('https://api.github.com/gists', {
        method:  'POST',
        headers: gistHeaders(token),
        body:    JSON.stringify({
          description: 'GitHub Bookmarks — App Data',
          public:      false,
          files:       { [GIST_FILENAME]: { content: body } },
        }),
      });
    }

    if (res.status === 401) throw new Error('Invalid token — check your Personal Access Token.');
    if (!res.ok) throw new Error(`GitHub API error (${res.status}).`);

    data = await res.json();

    localStorage.setItem(SYNC_TOKEN_KEY, token);
    localStorage.setItem(SYNC_GIST_KEY,  data.id);
    gistIdInput.value = data.id;

    const ts = new Date().toLocaleTimeString();
    setModalStatus('ok', `Saved ✓ — Gist ID: ${data.id}`);
    setSyncStatus('ok', `Last synced ${ts} · Gist ${data.id.slice(0, 8)}…`);
  } catch (err) {
    setModalStatus('error', err.message);
  } finally {
    setBtnsDisabled(false);
  }
}

async function pullFromGist() {
  const token  = tokenInput.value.trim();
  const gistId = gistIdInput.value.trim() || localStorage.getItem(SYNC_GIST_KEY) || '';

  if (!token)  { setModalStatus('error', 'Please enter a Personal Access Token.'); return; }
  if (!gistId) { setModalStatus('error', 'Please enter a Gist ID (or save first to create one).'); return; }

  setModalStatus('busy', 'Loading from Gist…');
  setBtnsDisabled(true);

  try {
    const pulled = await gistFetch(token, gistId);
    if (!pulled) throw new Error('Gist is empty or file not found.');

    localStorage.setItem(SYNC_TOKEN_KEY, token);
    localStorage.setItem(SYNC_GIST_KEY,  gistId);

    mergeFromGist(pulled);
    const ts = new Date().toLocaleTimeString();
    setModalStatus('ok', `Loaded ✓ — ${pulled.length} bookmarks synced.`);
    setSyncStatus('ok', `Last synced ${ts} · Gist ${gistId.slice(0, 8)}…`);
  } catch (err) {
    setModalStatus('error', err.message);
  } finally {
    setBtnsDisabled(false);
  }
}

async function gistFetch(token, gistId) {
  token  = token  || localStorage.getItem(SYNC_TOKEN_KEY);
  gistId = gistId || localStorage.getItem(SYNC_GIST_KEY);
  if (!token || !gistId) return null;

  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: gistHeaders(token),
  });
  if (!res.ok) throw new Error(`Could not fetch Gist (${res.status}).`);

  const data    = await res.json();
  const file    = data.files[GIST_FILENAME];
  if (!file)    throw new Error(`File "${GIST_FILENAME}" not found in Gist.`);

  return JSON.parse(file.content);
}

function mergeFromGist(remote) {
  const existingIds = new Set(bookmarks.map(b => b.id));
  const newOnes = remote
    .filter(b => b.id && !existingIds.has(b.id))
    .map(b => ({ category: DEFAULT_CAT, topics: [], ...b }));

  // Replace all with remote (remote is source of truth on pull)
  bookmarks = remote.map(b => ({ category: DEFAULT_CAT, topics: [], ...b }));
  saveBookmarks();
  renderAll();
  renderFilterBar();
  updateCategorySuggestions();
}

async function silentPush() {
  try {
    const token  = localStorage.getItem(SYNC_TOKEN_KEY);
    const gistId = localStorage.getItem(SYNC_GIST_KEY);
    if (!token || !gistId) return;

    await fetch(`https://api.github.com/gists/${gistId}`, {
      method:  'PATCH',
      headers: gistHeaders(token),
      body:    JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(bookmarks, null, 2) } } }),
    });

    const ts = new Date().toLocaleTimeString();
    setSyncStatus('ok', `Last synced ${ts} · Gist ${gistId.slice(0, 8)}…`);
  } catch { /* silent */ }
}

function disconnect() {
  localStorage.removeItem(SYNC_TOKEN_KEY);
  localStorage.removeItem(SYNC_GIST_KEY);
  tokenInput.value  = '';
  gistIdInput.value = '';
  setModalStatus('ok', 'Disconnected from Gist sync.');
  syncStatusBar.classList.add('hidden');
}

function gistHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept:        'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal() {
  syncModalStatus.classList.add('hidden');
  syncModal.classList.remove('hidden');
  tokenInput.focus();
}

function closeModal() {
  syncModal.classList.add('hidden');
}

function setModalStatus(type, msg) {
  syncModalStatus.className = `sync-modal-status ${type}`;
  syncModalStatus.textContent = msg;
  syncModalStatus.classList.remove('hidden');
}

function setBtnsDisabled(on) {
  pushBtn.disabled = on;
  pullBtn.disabled = on;
}

function setSyncStatus(type, msg) {
  syncStatusBar.className = `sync-status-bar ${type}`;
  syncStatusText.textContent = msg;
  syncStatusBar.classList.remove('hidden');
}

// ── State helpers ─────────────────────────────────────────────────────────────
function updateEmptyState() {
  const count = bookmarks.length;
  empty.classList.toggle('hidden', grid.children.length > 0);
  if (footerCount) {
    footerCount.textContent = count === 0 ? '' : `${count} REPO${count === 1 ? '' : 'S'} ARCHIVED`;
  }
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
}

function clearError() {
  errorEl.textContent = '';
  errorEl.classList.add('hidden');
}

function setLoading(on) {
  addBtn.disabled   = on;
  addBtn.textContent = on ? 'ADDING…' : 'ADD →';
}

// ── Persistence ───────────────────────────────────────────────────────────────
function loadBookmarks() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    return stored.map(b => ({ category: DEFAULT_CAT, topics: [], ...b }));
  } catch { return []; }
}

function saveBookmarks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return n.toString();
}

function toTitleCase(str) {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}
