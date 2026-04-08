'use strict';

const STORAGE_KEY    = 'gh-bookmarks';
const DEFAULT_CAT    = 'Uncategorized';

// ── DOM refs ─────────────────────────────────────────────────────────────────
const input           = document.getElementById('url-input');
const categoryInput   = document.getElementById('category-input');
const categorySuggest = document.getElementById('category-suggestions');
const suggestionsEl   = document.getElementById('suggestions');
const addBtn          = document.getElementById('add-btn');
const errorEl         = document.getElementById('error-msg');
const grid            = document.getElementById('grid');
const empty           = document.getElementById('empty-state');
const footerCount     = document.getElementById('footer-count');
const filterBar       = document.getElementById('filter-bar');
const filterBarInner  = filterBar.querySelector('.filter-bar-inner');
const toolbar         = document.getElementById('toolbar');
const searchInput     = document.getElementById('search-input');
const searchClear     = document.getElementById('search-clear');
const searchCount     = document.getElementById('search-result-count');
const sortSelect      = document.getElementById('sort-select');

// ── State ─────────────────────────────────────────────────────────────────────
let bookmarks      = loadBookmarks();
let activeCategory = '__all__';
let searchQuery    = '';
let sortOrder      = 'date'; // 'date' | 'alpha' | 'stars'
let urlDebounce    = null;
let searchDebounce = null;

// ── Init ──────────────────────────────────────────────────────────────────────
renderAll();
renderFilterBar();
updateCategorySuggestions();

input.addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
categoryInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleAdd(); });
addBtn.addEventListener('click', handleAdd);

// Search
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

// Sort
sortSelect.addEventListener('change', () => {
  sortOrder = sortSelect.value;
  renderAll();
});

// Smart suggestions while typing a URL
input.addEventListener('input', () => {
  clearTimeout(urlDebounce);
  const raw = input.value.trim();
  const parsed = raw ? parseGitHubUrl(raw) : null;
  if (!parsed) { hideSuggestions(); return; }
  urlDebounce = setTimeout(() => fetchSuggestions(parsed.owner, parsed.repo), 600);
});

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
  } catch (err) {
    skeletonCard.remove();
    showError(err.message);
  } finally {
    setLoading(false);
    updateEmptyState();
  }
}

// ── Smart category suggestions ────────────────────────────────────────────────
async function fetchSuggestions(owner, repo) {
  try {
    const data = await fetchRepo(owner, repo);
    const chips = buildSuggestions(data);
    renderSuggestions(chips);
  } catch {
    hideSuggestions();
  }
}

function buildSuggestions(data) {
  const candidates = new Set();

  // 1. GitHub topics are the most explicit signal
  (data.topics || []).forEach(t => candidates.add(toTitleCase(t.replace(/-/g, ' '))));

  // 2. Language → category
  if (data.language) candidates.add(data.language);

  // 3. Keyword scan over name + description
  const text = `${data.name} ${data.description || ''}`.toLowerCase();
  const KEYWORD_MAP = [
    [/\b(ai|llm|gpt|machine.?learning|deep.?learning|neural|nlp|diffusion|stable.?diffusion|langchain|openai|anthropic|hugging.?face)\b/, 'AI'],
    [/\b(react|vue|angular|svelte|next\.?js|nuxt|remix|frontend|ui.?library|component)\b/, 'Frontend'],
    [/\b(api|backend|server|express|fastapi|django|rails|rest|graphql|grpc|microservice)\b/, 'Backend'],
    [/\b(cli|terminal|shell|command.?line|tui)\b/, 'CLI Tools'],
    [/\b(docker|kubernetes|k8s|terraform|ansible|devops|infra|helm|cicd|ci\/cd)\b/, 'DevOps'],
    [/\b(ios|android|flutter|react.?native|mobile|swift|kotlin)\b/, 'Mobile'],
    [/\b(database|sql|postgres|mysql|mongo|redis|sqlite|orm|prisma)\b/, 'Database'],
    [/\b(security|auth|crypto|jwt|oauth|vulnerability|pentest|encryption)\b/, 'Security'],
    [/\b(game|unity|godot|opengl|vulkan|pygame|phaser)\b/, 'Games'],
    [/\b(data|analytics|visualization|pandas|numpy|spark|tableau|etl|pipeline)\b/, 'Data'],
    [/\b(testing|test|jest|pytest|cypress|playwright|e2e)\b/, 'Testing'],
    [/\b(design|figma|css|sass|tailwind|typography|icon)\b/, 'Design'],
    [/\b(blockchain|web3|solidity|ethereum|nft|defi)\b/, 'Web3'],
  ];

  KEYWORD_MAP.forEach(([re, label]) => {
    if (re.test(text)) candidates.add(label);
  });

  // 4. Prepend user's existing categories as quick-pick options
  getCategories()
    .filter(c => c !== DEFAULT_CAT)
    .slice(0, 3)
    .forEach(c => candidates.add(c));

  return [...candidates].slice(0, 8);
}

function renderSuggestions(chips) {
  if (!chips.length) { hideSuggestions(); return; }

  suggestionsEl.innerHTML = `<span class="suggestions-label">Suggest:</span>` +
    chips.map(c =>
      `<button class="suggestion-chip" type="button">${escHtml(c)}</button>`
    ).join('');

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

  // 1. Category filter
  let pool = activeCategory === '__all__'
    ? bookmarks
    : bookmarks.filter(b => (b.category || DEFAULT_CAT) === activeCategory);

  // 2. Search filter
  if (searchQuery) {
    pool = pool.filter(b =>
      b.fullName.toLowerCase().includes(searchQuery) ||
      (b.description || '').toLowerCase().includes(searchQuery) ||
      (b.language  || '').toLowerCase().includes(searchQuery) ||
      (b.category  || '').toLowerCase().includes(searchQuery) ||
      (b.topics    || []).some(t => t.toLowerCase().includes(searchQuery))
    );
  }

  // 3. Sort
  pool = [...pool].sort((a, b) => {
    if (sortOrder === 'alpha') return a.fullName.localeCompare(b.fullName);
    if (sortOrder === 'stars') return (b.stars || 0) - (a.stars || 0);
    return b.addedAt - a.addedAt; // 'date' — newest first
  });

  // Update search result count
  if (searchQuery) {
    searchCount.textContent = pool.length === 0
      ? `No results for "${searchInput.value.trim()}"`
      : `${pool.length} result${pool.length === 1 ? '' : 's'} for "${searchInput.value.trim()}"`;
    searchCount.classList.remove('hidden');
  } else {
    searchCount.classList.add('hidden');
  }

  if (pool.length === 0) { updateEmptyState(); return; }

  // 4. Group by category (skip headers when searching or filtered to one category)
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

  // Inline category editing
  const catChip = card.querySelector('.meta-item--category');
  const startEdit = () => editCategory(card, catChip, bookmark);
  catChip.addEventListener('click', startEdit);
  catChip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(); } });

  return card;
}

// ── Inline category edit ──────────────────────────────────────────────────────
function editCategory(card, chip, bookmark) {
  const current = bookmark.category || DEFAULT_CAT;

  const listId = 'inline-cat-list';
  let datalist = document.getElementById(listId);
  if (!datalist) {
    datalist = document.createElement('datalist');
    datalist.id = listId;
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = getCategories().map(c => `<option value="${escHtml(c)}">`).join('');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'category-inline-edit';
  input.value = current;
  input.setAttribute('list', listId);
  input.setAttribute('aria-label', 'Edit category');

  chip.replaceWith(input);
  input.focus();
  input.select();

  const commit = () => {
    const val = input.value.trim() || DEFAULT_CAT;
    bookmark.category = val;
    saveBookmarks();

    // Update chip text
    const newChip = document.createElement('span');
    newChip.className = 'meta-item meta-item--category';
    newChip.title = 'Click to edit category';
    newChip.role = 'button';
    newChip.tabIndex = 0;
    newChip.textContent = val;
    input.replaceWith(newChip);

    const startEdit = () => editCategory(card, newChip, bookmark);
    newChip.addEventListener('click', startEdit);
    newChip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startEdit(); } });

    renderFilterBar();
    updateCategorySuggestions();

    // Re-render if viewing a category that no longer matches
    if (activeCategory !== '__all__' && val !== activeCategory) {
      renderAll();
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = current; input.blur(); }
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
      // Clean up orphaned category headers
      grid.querySelectorAll('.category-header').forEach(h => {
        const next = h.nextElementSibling;
        if (!next || next.classList.contains('category-header')) h.remove();
      });
      renderFilterBar();
      updateCategorySuggestions();
      updateEmptyState();
    }, 120);
  }
}

// ── Filter bar ────────────────────────────────────────────────────────────────
function renderFilterBar() {
  const categories = getCategories();
  const hasBookmarks = bookmarks.length > 0;

  filterBar.classList.toggle('hidden', !hasBookmarks);
  toolbar.classList.toggle('hidden', !hasBookmarks);

  filterBarInner.innerHTML = '';
  if (!hasBookmarks) return;

  filterBarInner.appendChild(makeTab('ALL', '__all__'));
  categories.forEach(cat => {
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
  categorySuggest.innerHTML = getCategories()
    .map(c => `<option value="${escHtml(c)}">`)
    .join('');
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
  addBtn.disabled = on;
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
