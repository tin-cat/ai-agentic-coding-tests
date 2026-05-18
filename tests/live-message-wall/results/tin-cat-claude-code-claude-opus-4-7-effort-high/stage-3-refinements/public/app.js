(() => {
  const $input = document.getElementById('message-input');
  const $btn = document.getElementById('submit-btn');
  const $status = document.getElementById('status');
  const $wall = document.getElementById('wall');
  const $inner = document.getElementById('wall-inner');
  const $modal = document.getElementById('modal');
  const $modalText = document.getElementById('modal-text');
  const $modalMeta = document.getElementById('modal-meta');
  const $modalClose = document.getElementById('modal-close');
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
    messages: [],            // newest-first
    seen: new Set(),
    hasMore: true,
    loading: false,
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

    card.addEventListener('click', () => openModal(msg));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(msg);
      }
    });

    return card;
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
    // Cards are laid out column-by-column; pick the first whose right edge is
    // past the wall's left edge -- the leftmost visible card. Its date is a
    // good approximation for what the user is currently looking at.
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
    // Match http(s):// URLs and www.* URLs. Trailing punctuation is trimmed
    // off the link and rendered as plain text so periods at the end of
    // sentences don't get swallowed.
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
        // .href is assigned via the property (not innerHTML) so javascript:
        // schemes can't sneak in via injection; regex only matched http/s/www.
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

  function openModal(msg) {
    $modalText.textContent = '';
    appendTextWithLinks($modalText, msg.text);
    $modalMeta.textContent =
      `${shortId(msg.id)}  --  ${fmtDate(msg.createdAt)}  --  ${msg.text.length} chars`;
    $modal.classList.add('open');
    $modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => $modalClose.focus(), 0);
  }
  function closeModal() {
    $modal.classList.remove('open');
    $modal.setAttribute('aria-hidden', 'true');
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
  function enforceByteLimit() {
    if (byteLength($input.value) <= MAX_BYTES) return false;
    let v = $input.value;
    while (v.length && byteLength(v) > MAX_BYTES) {
      // Step back one code point, accounting for UTF-16 surrogate pairs.
      const cc = v.charCodeAt(v.length - 1);
      const back = (cc >= 0xDC00 && cc <= 0xDFFF && v.length >= 2) ? 2 : 1;
      v = v.slice(0, -back);
    }
    $input.value = v;
    showToast(`message limit is ${MAX_BYTES} bytes -- truncated.`, { kind: 'err' });
    return true;
  }

  function autoSizeInput() {
    $input.style.height = 'auto';
    const focused = document.activeElement === $input;
    const hasContent = $input.value.length > 0;
    const expand = focused || hasContent;
    $input.classList.toggle('expanded', expand);

    const minH = expand ? 140 : 26;
    const maxH = Math.max(160, Math.floor(window.innerHeight * 0.5));
    const h = Math.max(minH, Math.min($input.scrollHeight + 2, maxH));
    $input.style.height = h + 'px';
  }

  $input.addEventListener('focus', autoSizeInput);
  $input.addEventListener('click', autoSizeInput);
  $input.addEventListener('input', () => {
    enforceByteLimit();
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

  // ----------------------------------------------------------------- submit
  async function submit() {
    const text = $input.value.trim();
    if (!text) return;
    $btn.disabled = true;
    $input.disabled = true;
    setStatus('posting...', '');
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken(),
        },
        body: JSON.stringify({ text }),
      });

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        const retryMs =
          Number(data.retryAfterMs) ||
          (Number(data.retryAfterSec) ? Number(data.retryAfterSec) * 1000 : 60_000);
        showRateLimitToast(retryMs);
        setStatus('rate limited', 'err');
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const msg = await res.json();
      prependNew(msg);
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

  $btn.addEventListener('click', submit);
  $input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
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
      if (data && data.type === 'new' && data.message) {
        prependNew(data.message);
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
    enforceByteLimit();
    autoSizeInput();
  }
  loadPage({ initial: true }).then(connectWS);
  $input.focus();
})();
