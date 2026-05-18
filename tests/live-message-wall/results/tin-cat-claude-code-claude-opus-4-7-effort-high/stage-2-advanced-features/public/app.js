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

  // ----------------------------------------------------------------- tuning
  const PAGE_SIZE = 100;
  const LAZY_LOAD_AHEAD_PX = 1200;          // start loading when this close to the right edge
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000; // matches server MAX_AGE_MS
  const AGE_REFRESH_MS = 30 * 1000;          // recompute card opacities every 30s

  /** Newest-first array of messages already in the DOM. */
  const state = {
    messages: [],
    seen: new Set(),
    hasMore: true,
    loading: false,
  };

  // -------------------------------------------------------------- rendering
  function fmtDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '????-??-?? ??:??';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function shortId(id) {
    const tail = String(id).split('-').pop() || id;
    return `#${tail}`;
  }

  function ageOpacity(iso) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return 1;
    const age = Math.max(0, Date.now() - t);
    if (age >= MONTH_MS) return 0;
    return 1 - age / MONTH_MS;
  }

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
    // keep view anchored at the start (newest) for the user
    $wall.scrollLeft = 0;
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

  // ------------------------------------------------------------------ modal
  function openModal(msg) {
    $modalText.textContent = msg.text;
    $modalMeta.textContent = `${shortId(msg.id)}  --  ${fmtDate(msg.createdAt)}  --  ${msg.text.length} chars`;
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

  // ----------------------------------------------------------------- status
  function setStatus(text, kind = '') {
    $status.textContent = text;
    $status.classList.remove('ok', 'err');
    if (kind) $status.classList.add(kind);
  }

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
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const msg = await res.json();
      // Optimistic: prepend now; if WS delivers same id, the seen-set dedups.
      prependNew(msg);
      $input.value = '';
      setStatus('ok.', 'ok');
    } catch (err) {
      setStatus(`${err.message}`, 'err');
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

  // --------------------------------------------------------- lazy loading
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
      if (initial) {
        renderAll(list);
      } else {
        appendOlder(list);
      }
      setStatus(state.hasMore ? `${state.messages.length} loaded` : `${state.messages.length} loaded (all)`, 'ok');
    } catch (err) {
      setStatus(`load error: ${err.message}`, 'err');
    } finally {
      state.loading = false;
    }
    // If the viewport is still under-filled after a load, fetch the next page
    // immediately so the user always has scroll headroom.
    maybeAutoFill();
  }

  function nearRightEdge() {
    const remaining = $wall.scrollWidth - $wall.scrollLeft - $wall.clientWidth;
    return remaining < LAZY_LOAD_AHEAD_PX;
  }

  function maybeAutoFill() {
    if (state.hasMore && !state.loading && nearRightEdge()) {
      loadPage();
    }
  }

  $wall.addEventListener('scroll', () => {
    if (nearRightEdge()) loadPage();
  }, { passive: true });

  window.addEventListener('resize', maybeAutoFill);

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

  // boot
  loadPage({ initial: true }).then(connectWS);
  $input.focus();
})();
