(function () {
  'use strict';

  // State
  let currentSlug = null;
  let currentPost = null;
  let searchQuery = '';
  let selectedTag = '';
  let selectedCategory = '';
  let currentPage = 1;
  let pageSize = 20;
  let isDirty = false;
  let searchTimer = null;

  // Elements
  const els = {
    sitePath: document.getElementById('site-path'),
    search: document.getElementById('search'),
    tagFilter: document.getElementById('tag-filter'),
    categoryFilter: document.getElementById('category-filter'),
    postList: document.getElementById('post-list'),
    pagination: document.getElementById('pagination'),
    btnNew: document.getElementById('btn-new'),
    btnSave: document.getElementById('btn-save'),
    btnDelete: document.getElementById('btn-delete'),
    saveStatus: document.getElementById('save-status'),
    fmTitle: document.getElementById('fm-title'),
    fmDate: document.getElementById('fm-date'),
    fmSlug: document.getElementById('fm-slug'),
    fmTags: document.getElementById('fm-tags'),
    fmCategories: document.getElementById('fm-categories'),
    editor: document.getElementById('editor'),
    preview: document.getElementById('preview'),
    wordCount: document.getElementById('word-count'),
    emptyState: document.getElementById('empty-state'),
    cmdModal: document.getElementById('cmd-modal'),
    cmdTitle: document.getElementById('cmd-title'),
    cmdOutput: document.getElementById('cmd-output'),
    cmdClose: document.getElementById('cmd-close'),
    newModal: document.getElementById('new-modal'),
    newTitle: document.getElementById('new-title'),
    newCancel: document.getElementById('new-cancel'),
    newConfirm: document.getElementById('new-confirm'),
    btnHexoMenu: document.getElementById('btn-hexo-menu'),
    btnPublish: document.getElementById('btn-publish'),
    hexoMenu: document.getElementById('hexo-menu'),
    hexoMenuWrap: document.getElementById('hexo-menu-wrap'),
    hexoCmds: document.querySelectorAll('.hexo-cmd')
  };

  // Helpers
  function getToken() {
    return sessionStorage.getItem('admin-token') || '';
  }

  async function api(url, options = {}, retried = false) {
    const headers = { ...(options.headers || {}) };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 && !retried) {
      const pwd = prompt('请输入管理密码：');
      if (pwd !== null) {
        sessionStorage.setItem('admin-token', pwd);
        return api(url, options, true);
      }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const e = new Error(err.error || err.message || res.statusText);
      e.data = err;
      throw e;
    }
    return res.json();
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function renderMarkdown(text) {
    return marked.parse(text || '');
  }

  let statusTimer = null;
  function showStatus(msg, type = 'info') {
    if (statusTimer) clearTimeout(statusTimer);
    els.saveStatus.textContent = msg;
    els.saveStatus.className = 'text-xs ml-2 ' + (type === 'success' ? 'text-emerald-600' : type === 'error' ? 'text-red-600' : 'text-slate-400');
    if (type !== 'error' && !isDirty) {
      statusTimer = setTimeout(() => { els.saveStatus.textContent = ''; }, 3000);
    }
  }

  function updateWordCount() {
    const text = els.editor.value || '';
    els.wordCount.textContent = `${text.length} 字符 / ${text.replace(/\s/g, '').length} 字`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Dirty state
  function setDirty(v) {
    isDirty = v;
    if (v) {
      if (statusTimer) clearTimeout(statusTimer);
      els.saveStatus.textContent = '● 未保存的更改';
      els.saveStatus.className = 'text-xs ml-2 text-amber-600';
      els.btnSave.classList.add('ring-2', 'ring-emerald-300');
    } else {
      els.btnSave.classList.remove('ring-2', 'ring-emerald-300');
    }
  }

  function confirmDiscardIfDirty() {
    if (!isDirty) return true;
    return confirm('当前文章有未保存的更改，切换后将丢失。确定要放弃这些更改吗？');
  }

  function updateActionButtons() {
    const hasPost = Boolean(currentSlug);
    els.btnSave.disabled = !hasPost;
    els.btnDelete.disabled = !hasPost;
    [els.btnSave, els.btnDelete].forEach(btn => {
      btn.classList.toggle('opacity-40', !hasPost);
      btn.classList.toggle('cursor-not-allowed', !hasPost);
    });
    els.emptyState.classList.toggle('hidden', hasPost);
  }

  // Config
  async function loadConfig() {
    try {
      const cfg = await api('/api/config');
      els.sitePath.textContent = `站点: ${cfg.sitePath}`;
    } catch (e) {
      els.sitePath.textContent = `未配置 HEXO_SITE_PATH`;
    }
  }

  // Post list
  async function loadPosts() {
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedTag) params.set('tag', selectedTag);
    if (selectedCategory) params.set('category', selectedCategory);
    params.set('page', currentPage);
    params.set('pageSize', pageSize);

    try {
      const data = await api(`/api/posts?${params.toString()}`);
      renderPostList(data.items);
      renderPagination(data);
      updateFilters(data.tags, data.categories);
    } catch (e) {
      els.postList.innerHTML = `<div class="p-4 text-sm text-red-600">加载失败: ${escapeHtml(e.message)}</div>`;
    }
  }

  function renderPostList(posts) {
    if (!posts.length) {
      els.postList.innerHTML = `<div class="p-4 text-sm text-slate-400 text-center">未找到文章</div>`;
      return;
    }
    els.postList.innerHTML = posts.map(p => `
      <div class="post-item rounded-lg px-3 py-2 ${p.slug === currentSlug ? 'active' : ''}" data-slug="${escapeHtml(p.slug)}" title="${escapeHtml(p.title)}">
        <div class="text-sm font-medium text-slate-700 truncate">${escapeHtml(p.title)}</div>
        <div class="flex items-center justify-between mt-1">
          <span class="text-xs text-slate-400">${p.date ? formatDate(p.date).slice(0, 10) : '无日期'}</span>
          ${p.tags.length ? `<span class="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">${escapeHtml(p.tags[0])}</span>` : ''}
        </div>
      </div>
    `).join('');

    els.postList.querySelectorAll('.post-item').forEach(el => {
      el.addEventListener('click', () => openPost(el.dataset.slug));
    });
  }

  function renderPagination(data) {
    if (!data.total) {
      els.pagination.innerHTML = '';
      return;
    }
    const pages = [];
    const maxPage = data.totalPages;
    const start = Math.max(1, currentPage - 2);
    const end = Math.min(maxPage, currentPage + 2);

    pages.push(`<button data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''} class="px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-30">上一页</button>`);
    if (start > 1) pages.push(`<span class="px-1">...</span>`);
    for (let i = start; i <= end; i++) {
      pages.push(`<button data-page="${i}" class="px-2 py-1 rounded ${i === currentPage ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100'}">${i}</button>`);
    }
    if (end < maxPage) pages.push(`<span class="px-1">...</span>`);
    pages.push(`<button data-page="${currentPage + 1}" ${currentPage >= maxPage ? 'disabled' : ''} class="px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-30">下一页</button>`);
    pages.push(`<span class="text-slate-400">${data.total} 篇</span>`);

    els.pagination.innerHTML = pages.join('');
    els.pagination.querySelectorAll('button[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = parseInt(btn.dataset.page, 10);
        if (page >= 1 && page <= maxPage && page !== currentPage) {
          currentPage = page;
          loadPosts();
        }
      });
    });
  }

  function updateFilters(tags, categories) {
    const tagVal = els.tagFilter.value;
    els.tagFilter.innerHTML = '<option value="">所有标签</option>' +
      tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    els.tagFilter.value = tagVal;

    const catVal = els.categoryFilter.value;
    els.categoryFilter.innerHTML = '<option value="">所有分类</option>' +
      categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    els.categoryFilter.value = catVal;
  }

  // Editing
  async function openPost(slug) {
    if (!slug || slug === currentSlug) return;
    if (!confirmDiscardIfDirty()) return;
    try {
      currentPost = await api(`/api/posts/${encodeURIComponent(slug)}`);
      currentSlug = slug;
      renderEditor();
      loadPosts(); // refresh active state
    } catch (e) {
      showStatus(`加载失败: ${e.message}`, 'error');
    }
  }

  function renderEditor() {
    if (!currentPost) return;
    const fm = currentPost.frontMatter || {};
    els.fmTitle.value = fm.title || '';
    els.fmDate.value = fm.date ? formatDate(fm.date) : '';
    els.fmSlug.value = currentPost.slug;
    els.fmTags.value = arrayToString(fm.tags);
    els.fmCategories.value = arrayToString(fm.categories);
    els.editor.value = currentPost.content || '';
    // Reset scroll positions so updatePreview renders the new post from the top.
    els.editor.scrollTop = 0;
    els.preview.scrollTop = 0;
    updatePreview();
    updateWordCount();
    setDirty(false);
    updateActionButtons();
  }

  function updatePreview() {
    // Preserve the preview scroll ratio across the re-render so the view
    // does not jump back to the top while typing.
    const p = els.preview;
    const max = p.scrollHeight - p.clientHeight;
    const ratio = max > 0 ? p.scrollTop / max : 0;
    p.innerHTML = renderMarkdown(els.editor.value);
    const newMax = p.scrollHeight - p.clientHeight;
    p.scrollTop = ratio * (newMax > 0 ? newMax : 0);
  }

  // Bidirectional proportional scroll sync between editor and preview.
  let scrollSyncing = false;
  function syncScroll(source, target) {
    if (scrollSyncing) return;
    scrollSyncing = true;
    const max = source.scrollHeight - source.clientHeight;
    const ratio = max > 0 ? source.scrollTop / max : 0;
    const targetMax = target.scrollHeight - target.clientHeight;
    target.scrollTop = ratio * (targetMax > 0 ? targetMax : 0);
    // Release the lock after the programmatic scroll event has been delivered.
    requestAnimationFrame(() => { scrollSyncing = false; });
  }

  function arrayToString(value) {
    if (!value) return '';
    if (Array.isArray(value)) return value.join(', ');
    return String(value);
  }

  function stringToArray(str) {
    return str.split(/[,，]/).map(s => s.trim()).filter(Boolean);
  }

  async function savePost() {
    if (!currentSlug) return;
    showStatus('保存中...');
    try {
      await api(`/api/posts/${encodeURIComponent(currentSlug)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: els.fmTitle.value,
          date: els.fmDate.value,
          tags: stringToArray(els.fmTags.value),
          categories: stringToArray(els.fmCategories.value),
          content: els.editor.value
        })
      });
      setDirty(false);
      showStatus('已保存', 'success');
      loadPosts();
    } catch (e) {
      showStatus(`保存失败: ${e.message}`, 'error');
    }
  }

  async function createPost() {
    const title = els.newTitle.value.trim();
    if (!title) return;
    if (!confirmDiscardIfDirty()) return;
    try {
      const result = await api('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      hideNewModal();
      els.newTitle.value = '';
      currentPage = 1;
      await loadPosts();
      currentSlug = null; // openPost skips re-opening the same slug
      await openPost(result.slug);
      showStatus('创建成功', 'success');
    } catch (e) {
      showStatus(`创建失败: ${e.message}`, 'error');
    }
  }

  async function deletePost() {
    if (!currentSlug) return;
    if (!confirm(`确定要删除「${els.fmTitle.value || currentSlug}」吗？此操作不可恢复。`)) return;
    try {
      await api(`/api/posts/${encodeURIComponent(currentSlug)}`, { method: 'DELETE' });
      currentSlug = null;
      currentPost = null;
      clearEditor();
      loadPosts();
      showStatus('已删除', 'success');
    } catch (e) {
      showStatus(`删除失败: ${e.message}`, 'error');
    }
  }

  function clearEditor() {
    els.fmTitle.value = '';
    els.fmDate.value = '';
    els.fmSlug.value = '';
    els.fmTags.value = '';
    els.fmCategories.value = '';
    els.editor.value = '';
    els.preview.innerHTML = '';
    updateWordCount();
    setDirty(false);
    updateActionButtons();
  }

  // Hexo commands
  async function runHexoCommand(command) {
    if (command === 'deploy') {
      if (!confirm('确定要执行 hexo deploy 吗？这将把博客发布到线上。')) return;
    }
    els.cmdTitle.textContent = `执行: hexo ${command}`;
    els.cmdOutput.textContent = '运行中...';
    els.cmdOutput.className = 'flex-1 overflow-auto p-4 text-xs font-mono bg-slate-900 text-slate-100 m-0 rounded-b-xl';
    showCmdModal();
    try {
      const result = await api(`/api/hexo/${command}`, { method: 'POST' });
      els.cmdOutput.textContent = `$ ${result.command}\n\n${result.stdout || ''}\n${result.stderr || ''}`.trim();
    } catch (e) {
      els.cmdOutput.textContent = `错误: ${e.message}`;
      els.cmdOutput.className = 'flex-1 overflow-auto p-4 text-xs font-mono bg-slate-900 text-red-300 m-0 rounded-b-xl';
    }
  }

  // One-click publish: hexo clean → generate → deploy
  async function publish() {
    if (isDirty) {
      showStatus('有未保存的更改，请先保存再发布', 'error');
      return;
    }
    if (!confirm('确定要发布吗？将依次执行 hexo clean → generate → deploy。')) return;
    els.cmdTitle.textContent = '一键发布 (clean → generate → deploy)';
    els.cmdOutput.textContent = '发布中，可能需要几分钟，请耐心等待...';
    els.cmdOutput.className = 'flex-1 overflow-auto p-4 text-xs font-mono bg-slate-900 text-slate-100 m-0 rounded-b-xl';
    showCmdModal();
    try {
      const result = await api('/api/hexo/publish', { method: 'POST' });
      els.cmdOutput.textContent = result.output + '\n发布成功 ✔';
    } catch (e) {
      els.cmdOutput.textContent = (e.data && e.data.output ? e.data.output + '\n' : '') + `发布失败: ${e.message}`;
      els.cmdOutput.className = 'flex-1 overflow-auto p-4 text-xs font-mono bg-slate-900 text-red-300 m-0 rounded-b-xl';
    }
  }

  function showCmdModal() {
    els.cmdModal.classList.remove('hidden');
    els.cmdModal.classList.add('flex');
  }

  function hideCmdModal() {
    els.cmdModal.classList.add('hidden');
    els.cmdModal.classList.remove('flex');
  }

  function showNewModal() {
    els.newModal.classList.remove('hidden');
    els.newModal.classList.add('flex');
    setTimeout(() => els.newTitle.focus(), 50);
  }

  function hideNewModal() {
    els.newModal.classList.add('hidden');
    els.newModal.classList.remove('flex');
  }

  function toggleHexoMenu(show) {
    const willShow = show !== undefined ? show : els.hexoMenu.classList.contains('hidden');
    els.hexoMenu.classList.toggle('hidden', !willShow);
  }

  // Event bindings
  els.search.addEventListener('input', (e) => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = e.target.value;
      currentPage = 1;
      loadPosts();
    }, 300);
  });

  els.tagFilter.addEventListener('change', (e) => {
    selectedTag = e.target.value;
    currentPage = 1;
    loadPosts();
  });

  els.categoryFilter.addEventListener('change', (e) => {
    selectedCategory = e.target.value;
    currentPage = 1;
    loadPosts();
  });

  els.btnNew.addEventListener('click', showNewModal);
  els.newCancel.addEventListener('click', hideNewModal);
  els.newConfirm.addEventListener('click', createPost);
  els.newTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createPost();
  });

  els.btnSave.addEventListener('click', savePost);
  els.btnDelete.addEventListener('click', deletePost);

  let previewTimer = null;
  els.editor.addEventListener('input', () => {
    // Debounce the markdown re-render; word count and dirty state stay instant.
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(updatePreview, 150);
    updateWordCount();
    setDirty(true);
  });

  els.editor.addEventListener('scroll', () => syncScroll(els.editor, els.preview));
  els.preview.addEventListener('scroll', () => syncScroll(els.preview, els.editor));

  [els.fmTitle, els.fmDate, els.fmTags, els.fmCategories].forEach(input => {
    input.addEventListener('input', () => setDirty(true));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      savePost();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  els.btnPublish.addEventListener('click', publish);

  els.btnHexoMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHexoMenu();
  });

  document.addEventListener('click', (e) => {
    if (!els.hexoMenuWrap.contains(e.target)) toggleHexoMenu(false);
  });

  els.hexoCmds.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleHexoMenu(false);
      runHexoCommand(btn.dataset.cmd);
    });
  });

  els.cmdClose.addEventListener('click', hideCmdModal);
  els.cmdModal.addEventListener('click', (e) => {
    if (e.target === els.cmdModal) hideCmdModal();
  });

  // Init
  async function init() {
    updateActionButtons();
    await loadConfig();
    await loadPosts();
  }

  init();
})();
