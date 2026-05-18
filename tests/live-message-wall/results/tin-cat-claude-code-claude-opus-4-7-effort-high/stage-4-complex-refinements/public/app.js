(() => {
  const $input = document.getElementById('message-input');
  const $btn = document.getElementById('submit-btn');
  const $status = document.getElementById('status');
  const $wall = document.getElementById('wall');
  const $inner = document.getElementById('wall-inner');
  const $modal = document.getElementById('modal');
  const $modalScroll = document.getElementById('modal-scroll');
  const $modalText = document.getElementById('modal-text');
  const $modalMeta = document.getElementById('modal-meta');
  const $modalClose = document.getElementById('modal-close');
  const $replyForm = document.getElementById('reply-form');
  const $replyInput = document.getElementById('reply-input');
  const $replyBtn = document.getElementById('reply-btn');
  const $replyStatus = document.getElementById('reply-status');
  const $repliesHeader = document.getElementById('replies-header');
  const $repliesList = document.getElementById('replies-list');
  const $toast = document.getElementById('toast');
  const $dateHeader = document.getElementById('date-header');

  // ----------------------------------------------------------------- tuning
  const PAGE_SIZE = 100;
  const LAZY_LOAD_AHEAD_PX = 1200;
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
  const AGE_REFRESH_MS = 30 * 1000;
  const MAX_BYTES = 4 * 1024;
  const DRAFT_KEY = 'wall.draft';
  const CSRF_COOKIE = 'wallClient';

  const state = {
    messages: [],            // top-level, newest-first
    seen: new Set(),
    hasMore: true,
    loading: false,
    // modal
    openMsg: null,
    openReplies: [],         // newest-first
    openReplyIds: new Set(),
  };

  // ----------------------------------------------------------------- helpers
  const pad = (n) => String(n).padStart(2, '0');

  function fmtDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '????-??-?? ??:?? UTC';
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
           `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  }

  function fmtDateOnly(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '????-??-?? UTC';
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} UTC`;
  }

  function shortId(id) {
    const tail = String(id).split('-').pop() || id;
    return `#${tail}`;
  }

  function byteLength(s) {
    try { return new Blob([s]).size; }
    catch { return s.length; }
  }

  function getCookie(name) {
    const safe = name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
    const m = document.cookie.match(new RegExp('(?:^|; )' + safe + '=([^;]*)'));
    return m ? m[1] : '';
  }

  function csrfToken() { return getCookie(CSRF_COOKIE); }

  function ageOpacity(iso) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 1;
    const age = Math.max(0, Date.now() - t);
    if (age >= MONTH_MS) return 0;
    return 1 - age / MONTH_MS;
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  function replyCountLabel(n) {
    return `${n} ${n === 1 ? 'reply' : 'replies'}`;
  }

  // -------------------------------------------------------------- rendering
  function buildCard(msg, { animate = false } = {}) {
    const card = document.createElement('article');
    card.className = 'card' + (animate ? ' new' : '');
    card.dataset.id = msg.id;
    card.dataset.createdAt = msg.createdAt;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', 'open full message');
    card.style.opacity = String(animate ? 1 : ageOpacity(msg.createdAt));

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const idEl = document.createElement('span');
    idEl.className = 'card-id';
    idEl.textContent = shortId(msg.id);
    const dateEl = document.createElement('span');
    dateEl.className = 'card-date';
    dateEl.textContent = fmtDate(msg.createdAt);
    meta.appendChild(idEl);
    meta.appendChild(dateEl);

    const body = document.createElement('div');
    body.className = 'card-body';
    body.textContent = msg.text;

    card.appendChild(meta);
    card.appendChild(body);

    const replyCountEl = document.createElement('button');
    replyCountEl.type = 'button';
    replyCountEl.className = 'card-replies';
    replyCountEl.setAttribute('aria-label', 'view replies');
    if (!msg.replyCount) replyCountEl.hidden = true;
    else replyCountEl.textContent = `[ ${replyCountLabel(msg.replyCount)} ]`;
    card.appendChild(replyCountEl);

    card.addEventListener('click', () => openModal(msg.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(msg.id);
      }
    });

    return card;
  }

  function updateCardReplyCount(parentId, count) {
    const card = $inner.querySelector(`[data-id="${CSS.escape(parentId)}"]`);
    if (!card) return;
    const badge = card.querySelector('.card-replies');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = `[ ${replyCountLabel(count)} ]`;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function findMessageById(id) {
    for (const m of state.messages) if (m.id === id) return m;
    return null;
  }

  function renderAll(messagesNewestFirst) {
    state.messages = messagesNewestFirst.slice();
    state.seen = new Set(state.messages.map((m) => m.id));
    $inner.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const m of state.messages) frag.appendChild(buildCard(m));
    $inner.appendChild(frag);
    updateDateHeader();
  }

  function appendOlder(msgs) {
    if (!msgs.length) return;
    const frag = document.createDocumentFragment();
    for (const m of msgs) {
      if (state.seen.has(m.id)) continue;
      state.seen.add(m.id);
      state.messages.push(m);
      frag.appendChild(buildCard(m));
    }
    $inner.appendChild(frag);
  }

  function prependNew(msg) {
    if (state.seen.has(msg.id)) return;
    state.seen.add(msg.id);
    state.messages.unshift(msg);
    const card = buildCard(msg, { animate: true });
    $inner.insertBefore(card, $inner.firstChild);
    $wall.scrollLeft = 0;
    updateDateHeader();
  }

  // -------------------------------------------------------------- age-fade
  function refreshAges() {
    let i = state.messages.length;
    while (i--) {
      const m = state.messages[i];
      const op = ageOpacity(m.createdAt);
      const card = $inner.querySelector(`[data-id="${CSS.escape(m.id)}"]`);
      if (!card) continue;
      if (op <= 0) {
        card.remove();
        state.seen.delete(m.id);
        state.messages.splice(i, 1);
      } else {
        card.style.opacity = String(op);
      }
    }
  }
  setInterval(refreshAges, AGE_REFRESH_MS);

  // ----------------------------------------------------------- date header
  function updateDateHeader() {
    const wallRect = $wall.getBoundingClientRect();
    const probeX = wallRect.left + 4;
    let iso = null;
    for (const card of $inner.children) {
      const rect = card.getBoundingClientRect();
      if (rect.right > probeX) {
        iso = card.dataset.createdAt;
        break;
      }
    }
    $dateHeader.textContent = iso ? fmtDateOnly(iso) : '';
  }

  // ------------------------------------------------------------------ modal
  function appendTextWithLinks(parent, text) {
    const urlRe = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;
    let lastIdx = 0;
    let match;
    while ((match = urlRe.exec(text)) !== null) {
      const before = text.slice(lastIdx, match.index);
      if (before) parent.appendChild(document.createTextNode(before));
      let raw = match[0];
      let trail = '';
      while (raw.length && /[.,;:!?)\]]/.test(raw[raw.length - 1])) {
        trail = raw[raw.length - 1] + trail;
        raw = raw.slice(0, -1);
      }
      if (raw) {
        const a = document.createElement('a');
        a.textContent = raw;
        a.href = raw.startsWith('www.') ? `https://${raw}` : raw;
        a.target = '_blank';
        a.rel = 'noopener noreferrer nofollow';
        parent.appendChild(a);
      }
      if (trail) parent.appendChild(document.createTextNode(trail));
      lastIdx = match.index + match[0].length;
    }
    const rest = text.slice(lastIdx);
    if (rest) parent.appendChild(document.createTextNode(rest));
  }

  function buildReplyRow(reply) {
    const row = document.createElement('div');
    row.className = 'reply';
    row.dataset.id = reply.id;

    const meta = document.createElement('div');
    meta.className = 'reply-meta';
    const idEl = document.createElement('span');
    idEl.className = 'card-id';
    idEl.textContent = shortId(reply.id);
    const dateEl = document.createElement('span');
    dateEl.className = 'card-date';
    dateEl.textContent = fmtDate(reply.createdAt);
    meta.appendChild(idEl);
    meta.appendChild(dateEl);

    const body = document.createElement('div');
    body.className = 'reply-body';
    appendTextWithLinks(body, reply.text);

    row.appendChild(meta);
    row.appendChild(body);
    return row;
  }

  function renderReplies() {
    $repliesList.innerHTML = '';
    const n = state.openReplies.length;
    if (n === 0) {
      $repliesHeader.textContent = '--- no replies yet ---';
    } else {
      $repliesHeader.textContent = `--- ${replyCountLabel(n)} ---`;
    }
    const frag = document.createDocumentFragment();
    for (const r of state.openReplies) frag.appendChild(buildReplyRow(r));
    $repliesList.appendChild(frag);
  }

  function prependReplyInModal(reply, { animate = false } = {}) {
    if (state.openReplyIds.has(reply.id)) return;
    state.openReplyIds.add(reply.id);
    state.openReplies.unshift(reply);
    const row = buildReplyRow(reply);
    if (animate) row.classList.add('new');
    if ($repliesList.firstChild) $repliesList.insertBefore(row, $repliesList.firstChild);
    else $repliesList.appendChild(row);
    $repliesHeader.textContent = `--- ${replyCountLabel(state.openReplies.length)} ---`;
  }

  async function openModal(id) {
    const msg = findMessageById(id);
    if (!msg) return;
    state.openMsg = msg;
    state.openReplies = [];
    state.openReplyIds = new Set();

    $modalText.textContent = '';
    appendTextWithLinks($modalText, msg.text);
    $modalMeta.textContent =
      `${shortId(msg.id)}  --  ${fmtDate(msg.createdAt)}  --  ${msg.text.length} chars`;
    $repliesHeader.textContent = '--- loading replies ---';
    $repliesList.innerHTML = '';
    $replyInput.value = '';
    setReplyStatus('', '');
    autoSizeTextarea($replyInput, { minH: 26, maxH: 180, focused: false });

    $modal.classList.add('open');
    $modal.setAttribute('aria-hidden', 'false');
    $modalScroll.scrollTop = 0;
    setTimeout(() => $replyInput.focus(), 0);

    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(msg.id)}/replies`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Bail out if the user closed the modal or opened a different message
      // while the request was in flight.
      if (!state.openMsg || state.openMsg.id !== msg.id) return;
      const list = Array.isArray(data.replies) ? data.replies : [];
      state.openReplies = list;
      state.openReplyIds = new Set(list.map((r) => r.id));
      renderReplies();
    } catch (err) {
      if (state.openMsg && state.openMsg.id === msg.id) {
        $repliesHeader.textContent = `--- failed to load replies: ${err.message} ---`;
      }
    }
  }

  function closeModal() {
    $modal.classList.remove('open');
    $modal.setAttribute('aria-hidden', 'true');
    state.openMsg = null;
    state.openReplies = [];
    state.openReplyIds = new Set();
    $replyInput.value = '';
    setReplyStatus('', '');
  }
  $modalClose.addEventListener('click', closeModal);
  $modal.addEventListener('click', (e) => { if (e.target === $modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $modal.classList.contains('open')) closeModal();
  });

  // ----------------------------------------------------------- status/toast
  function setStatus(text, kind = '') {
    $status.textContent = text;
    $status.classList.remove('ok', 'err');
    if (kind) $status.classList.add(kind);
  }

  function setReplyStatus(text, kind = '') {
    $replyStatus.textContent = text;
    $replyStatus.classList.remove('ok', 'err');
    if (kind) $replyStatus.classList.add(kind);
  }

  let toastHideTimer = null;
  let toastCountdownTimer = null;
  function hideToast() {
    $toast.classList.remove('open', 'err');
    $toast.setAttribute('aria-hidden', 'true');
    if (toastCountdownTimer) { clearInterval(toastCountdownTimer); toastCountdownTimer = null; }
  }
  function showToast(text, { kind = '', ms = 3500 } = {}) {
    if (toastHideTimer) clearTimeout(toastHideTimer);
    if (toastCountdownTimer) { clearInterval(toastCountdownTimer); toastCountdownTimer = null; }
    $toast.textContent = text;
    $toast.classList.toggle('err', kind === 'err');
    $toast.classList.add('open');
    $toast.setAttribute('aria-hidden', 'false');
    if (ms > 0) toastHideTimer = setTimeout(hideToast, ms);
  }
  function showRateLimitToast(retryAfterMs) {
    const endAt = Date.now() + retryAfterMs;
    if (toastCountdownTimer) clearInterval(toastCountdownTimer);
    if (toastHideTimer) clearTimeout(toastHideTimer);
    const tick = () => {
      const remaining = endAt - Date.now();
      if (remaining <= 0) { hideToast(); return; }
      $toast.textContent = `rate limited -- next post in ${formatDuration(remaining)}`;
    };
    tick();
    $toast.classList.add('open', 'err');
    $toast.setAttribute('aria-hidden', 'false');
    toastCountdownTimer = setInterval(tick, 1000);
    toastHideTimer = setTimeout(hideToast, retryAfterMs + 600);
  }

  // ------------------------------------------------------------------ draft
  function loadDraft() {
    try { return localStorage.getItem(DRAFT_KEY) || ''; }
    catch { return ''; }
  }
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, $input.value); }
    catch { /* quota or disabled storage -- silently drop */ }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); }
    catch { /* ignore */ }
  }

  // ------------------------------------------------------------ input sizing
  function enforceByteLimit(el, { onTruncate } = {}) {
    if (byteLength(el.value) <= MAX_BYTES) return false;
    let v = el.value;
    while (v.length && byteLength(v) > MAX_BYTES) {
      // Step back one code point, accounting for UTF-16 surrogate pairs.
      const cc = v.charCodeAt(v.length - 1);
      const back = (cc >= 0xDC00 && cc <= 0xDFFF && v.length >= 2) ? 2 : 1;
      v = v.slice(0, -back);
    }
    el.value = v;
    if (onTruncate) onTruncate();
    else showToast(`message limit is ${MAX_BYTES} bytes -- truncated.`, { kind: 'err' });
    return true;
  }

  function autoSizeTextarea(el, { minH, maxH, focused }) {
    el.style.height = 'auto';
    const isFocused = focused == null ? (document.activeElement === el) : focused;
    const hasContent = el.value.length > 0;
    const expand = isFocused || hasContent;
    el.classList.toggle('expanded', expand);
    const min = expand ? minH.expanded : minH.collapsed;
    const h = Math.max(min, Math.min(el.scrollHeight + 2, maxH));
    el.style.height = h + 'px';
  }

  // ------------------------------------------------------------ main composer
  const MAIN_HEIGHTS = { collapsed: 26, expanded: 140 };
  function mainMaxH() { return Math.max(160, Math.floor(window.innerHeight * 0.5)); }
  function autoSizeInput() {
    autoSizeTextarea($input, { minH: MAIN_HEIGHTS, maxH: mainMaxH() });
  }

  $input.addEventListener('focus', autoSizeInput);
  $input.addEventListener('click', autoSizeInput);
  $input.addEventListener('input', () => {
    enforceByteLimit($input);
    autoSizeInput();
    saveDraft();
  });
  $input.addEventListener('blur', () => {
    if (!$input.value) {
      $input.classList.remove('expanded');
      $input.style.height = '';
    } else {
      autoSizeInput();
    }
  });
  window.addEventListener('resize', () => {
    autoSizeInput();
    updateDateHeader();
  });

  // ------------------------------------------------------------ reply composer
  const REPLY_HEIGHTS = { collapsed: 26, expanded: 100 };
  function replyMaxH() { return Math.max(120, Math.floor(window.innerHeight * 0.3)); }
  function autoSizeReply() {
    autoSizeTextarea($replyInput, { minH: REPLY_HEIGHTS, maxH: replyMaxH() });
  }

  $replyInput.addEventListener('focus', autoSizeReply);
  $replyInput.addEventListener('click', autoSizeReply);
  $replyInput.addEventListener('input', () => {
    enforceByteLimit($replyInput);
    autoSizeReply();
  });
  $replyInput.addEventListener('blur', () => {
    if (!$replyInput.value) {
      $replyInput.classList.remove('expanded');
      $replyInput.style.height = '';
    } else {
      autoSizeReply();
    }
  });
  $replyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitReply();
    }
  });

  // -------------------------------------------------------------- post helper
  async function postMessage({ text, parentId }) {
    const body = parentId ? { text, parentId } : { text };
    const res = await fetch('/api/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken(),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      const retryMs =
        Number(data.retryAfterMs) ||
        (Number(data.retryAfterSec) ? Number(data.retryAfterSec) * 1000 : 60_000);
      showRateLimitToast(retryMs);
      return { rateLimited: true };
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return { message: await res.json() };
  }

  // ----------------------------------------------------------------- submit
  async function submit() {
    const text = $input.value.trim();
    if (!text) return;
    $btn.disabled = true;
    $input.disabled = true;
    setStatus('posting...', '');
    try {
      const result = await postMessage({ text });
      if (result.rateLimited) {
        setStatus('rate limited', 'err');
        return;
      }
      // The local copy carries replyCount: 0 so the card renders cleanly even
      // before the WS echo (which would also include it) arrives.
      prependNew({ ...result.message, replyCount: 0 });
      $input.value = '';
      clearDraft();
      autoSizeInput();
      setStatus('ok.', 'ok');
    } catch (err) {
      setStatus(`${err.message}`, 'err');
      showToast(err.message, { kind: 'err' });
    } finally {
      $btn.disabled = false;
      $input.disabled = false;
      $input.focus();
    }
  }

  async function submitReply() {
    const text = $replyInput.value.trim();
    if (!text) return;
    const target = state.openMsg;
    if (!target) return;
    $replyBtn.disabled = true;
    $replyInput.disabled = true;
    setReplyStatus('posting...', '');
    try {
      const result = await postMessage({ text, parentId: target.id });
      if (result.rateLimited) {
        setReplyStatus('rate limited', 'err');
        return;
      }
      // Only apply locally if the same modal is still open (user might have
      // closed it while the request was in flight).
      if (state.openMsg && state.openMsg.id === target.id) {
        prependReplyInModal(result.message, { animate: true });
      }
      // Bump the local count on the parent and any visible card.
      target.replyCount = (target.replyCount || 0) + 1;
      updateCardReplyCount(target.id, target.replyCount);
      $replyInput.value = '';
      autoSizeReply();
      setReplyStatus('ok.', 'ok');
    } catch (err) {
      setReplyStatus(`${err.message}`, 'err');
      showToast(err.message, { kind: 'err' });
    } finally {
      $replyBtn.disabled = false;
      $replyInput.disabled = false;
      $replyInput.focus();
    }
  }

  $btn.addEventListener('click', submit);
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  $replyForm.addEventListener('submit', (e) => {
    e.preventDefault();
    submitReply();
  });

  // Horizontal scroll: translate vertical wheel to horizontal on the wall.
  $wall.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0 && e.deltaX === 0) {
      $wall.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });

  // -------------------------------------------------------- lazy loading
  async function loadPage({ initial = false } = {}) {
    if (state.loading) return;
    if (!initial && !state.hasMore) return;
    state.loading = true;
    if (initial) setStatus('loading...', '');
    else setStatus('loading more...', '');
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (!initial && state.messages.length) {
        params.set('before', state.messages[state.messages.length - 1].createdAt);
      }
      const res = await fetch(`/api/messages?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data.messages) ? data.messages : [];
      state.hasMore = !!data.hasMore;
      if (initial) renderAll(list);
      else appendOlder(list);
      setStatus(
        state.hasMore
          ? `${state.messages.length} loaded`
          : `${state.messages.length} loaded (all)`,
        'ok'
      );
    } catch (err) {
      setStatus(`load error: ${err.message}`, 'err');
    } finally {
      state.loading = false;
    }
    maybeAutoFill();
  }

  function nearRightEdge() {
    const remaining = $wall.scrollWidth - $wall.scrollLeft - $wall.clientWidth;
    return remaining < LAZY_LOAD_AHEAD_PX;
  }

  function maybeAutoFill() {
    if (state.hasMore && !state.loading && nearRightEdge()) loadPage();
  }

  $wall.addEventListener('scroll', () => {
    updateDateHeader();
    if (nearRightEdge()) loadPage();
  }, { passive: true });

  // -------------------------------------------------------------- websocket
  let ws = null;
  let reconnectDelay = 500;
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}/ws`;
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      reconnectDelay = 500;
      setStatus('live.', 'ok');
    });
    ws.addEventListener('message', (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (!data) return;
      if (data.type === 'new' && data.message) {
        prependNew(data.message);
      } else if (data.type === 'reply' && data.message && data.parentId) {
        const parent = findMessageById(data.parentId);
        if (parent) {
          parent.replyCount = (parent.replyCount || 0) + 1;
          updateCardReplyCount(parent.id, parent.replyCount);
        }
        if (state.openMsg && state.openMsg.id === data.parentId) {
          prependReplyInModal(data.message, { animate: true });
        }
      }
    });
    ws.addEventListener('close', () => {
      setStatus('disconnected. retrying...', 'err');
      setTimeout(connectWS, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
    });
    ws.addEventListener('error', () => {
      try { ws.close(); } catch { /* ignore */ }
    });
  }

  // ----------------------------------------------------------------- boot
  const draft = loadDraft();
  if (draft) {
    $input.value = draft;
    enforceByteLimit($input);
    autoSizeInput();
  }
  loadPage({ initial: true }).then(connectWS);
  $input.focus();
})();
