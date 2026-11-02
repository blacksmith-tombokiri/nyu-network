(() => {
  const CFG = window.ZENNEWS_CONFIG;
  if (!CFG?.supabaseUrl || !CFG?.publishableKey) {
    document.body.innerHTML = '<p style="padding:24px">設定を読み込めませんでした。</p>';
    return;
  }

  const authBase = `${CFG.supabaseUrl}/auth/v1`;
  const restBase = `${CFG.supabaseUrl}/rest/v1`;
  const sessionKey = 'zennyu_admin_session_v1';
  let session = null;
  let items = [];
  let filter = 'all';

  const $ = (sel) => document.querySelector(sel);
  const loginPanel = $('#login-panel');
  const setupPanel = $('#setup-panel');
  const reviewApp = $('#review-app');
  const loginForm = $('#login-form');
  const loginMessage = $('#login-message');
  const userLabel = $('#user-label');
  const logoutBtn = $('#logout-btn');
  const listRoot = $('#review-list');
  const status = $('#status');

  function esc(v='') {
    return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function saveSession(data) {
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + Math.max(0, (Number(data.expires_in || 3600) - 30) * 1000),
      user: data.user
    };
    localStorage.setItem(sessionKey, JSON.stringify(session));
  }

  function clearSession() {
    session = null;
    localStorage.removeItem(sessionKey);
  }

  function loadSavedSession() {
    try {
      const data = JSON.parse(localStorage.getItem(sessionKey) || 'null');
      if (data?.access_token && data?.refresh_token) session = data;
    } catch {}
  }

  async function refreshSession() {
    if (!session?.refresh_token) return false;
    const res = await fetch(`${authBase}/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: CFG.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (!res.ok) { clearSession(); return false; }
    const data = await res.json();
    saveSession(data);
    return true;
  }

  async function ensureSession() {
    if (!session) return false;
    if ((session.expires_at || 0) < Date.now()) return refreshSession();
    return true;
  }

  async function api(path, { method='GET', body=null, prefer=null } = {}) {
    if (!(await ensureSession())) throw new Error('login_required');
    const headers = {
      apikey: CFG.publishableKey,
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json'
    };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${restBase}/${path}`, {
      method,
      headers,
      body: body === null ? undefined : JSON.stringify(body)
    });
    if (res.status === 401) {
      if (await refreshSession()) return api(path, { method, body, prefer });
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = data?.message || data?.hint || data?.error || `API ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function signIn(email, password) {
    const res = await fetch(`${authBase}/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: CFG.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.msg || data?.error_description || data?.message || 'ログインに失敗しました');
    saveSession(data);
    return data;
  }

  async function signOut() {
    if (session?.access_token) {
      try {
        await fetch(`${authBase}/logout`, {
          method: 'POST',
          headers: { apikey: CFG.publishableKey, Authorization: `Bearer ${session.access_token}` }
        });
      } catch {}
    }
    clearSession();
    location.reload();
  }

  async function getCurrentUser() {
    if (!(await ensureSession())) return null;
    const res = await fetch(`${authBase}/user`, {
      headers: { apikey: CFG.publishableKey, Authorization: `Bearer ${session.access_token}` }
    });
    if (!res.ok) {
      if (await refreshSession()) return getCurrentUser();
      return null;
    }
    return res.json();
  }

  async function isAdmin(userId) {
    const rows = await api(`nyu_admin_users?select=user_id,role&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    return rows.length > 0;
  }

  function showLogin() {
    loginPanel.hidden = false;
    setupPanel.hidden = true;
    reviewApp.hidden = true;
    logoutBtn.hidden = true;
    userLabel.textContent = '';
  }

  function showSetup(user) {
    loginPanel.hidden = true;
    setupPanel.hidden = false;
    reviewApp.hidden = true;
    logoutBtn.hidden = false;
    userLabel.textContent = user.email || 'ログイン済み';
    const sql = `insert into public.nyu_admin_users (user_id, role, is_active)\nvalues ('${user.id}', 'owner', true)\non conflict (user_id) do update\nset role = 'owner', is_active = true, updated_at = now();`;
    $('#bootstrap-sql').textContent = sql;
  }

  function fmtDate(v) {
    if (!v) return '日付不明';
    const d = new Date(v);
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    }).format(d);
  }

  function stateOf(item) {
    return item.article_status === 'published' ? 'published' : 'unpublished';
  }

  function visibleItems() {
    return filter === 'all' ? items : items.filter(x => stateOf(x) === filter);
  }

  function scoreHint(item) {
    const n = Number(item.score_total);
    if (n >= 79) return '自動掲載まであと1点';
    return `自動掲載まであと${80 - n}点`;
  }

  function rowHtml(item) {
    const published = stateOf(item) === 'published';
    const detailSummary = item.event_summary || item.source_summary || '要約情報はありません。';
    const reason = item.suggested_reason || item.gate_reason || '判定理由はありません。';
    return `<article class="review-row" data-id="${esc(item.evaluation_id)}">
      <div class="score">${esc(item.score_total)}<small>${esc(scoreHint(item))}</small></div>
      <div class="summary-title">${esc(item.suggested_title || item.source_title)}</div>
      <div class="source-title"><b>${esc(item.source_name || '')}</b><br><a href="${esc(item.source_url)}" target="_blank" rel="noopener noreferrer">${esc(item.source_title || '元ニュース')}</a></div>
      <div><span class="cat">${esc(item.category_label || '－')}</span></div>
      <div class="state-cell">
        <span class="state-label ${published ? 'published' : 'unpublished'}">${published ? '公開中' : '非公開'}</span>
        <button class="state-btn ${published ? 'unpublish' : ''}" type="button" data-action="${published ? 'unpublish' : 'publish'}">${published ? '非公開にする' : '公開する'}</button>
      </div>
      <details class="details">
        <summary>詳細を見る</summary>
        <div class="detail-box">
          <div class="detail-grid">
            <div><b>要約</b>${esc(detailSummary)}</div>
            <div><b>なぜこの点数か</b>${esc(reason)}</div>
            <div><b>善兆コメント</b>${esc(item.suggested_comment || '未作成')}</div>
            <div><b>スコア内訳</b>共通 ${esc(item.score_common)} / 60　カテゴリ ${esc(item.score_category)} / 40</div>
          </div>
        </div>
      </details>
    </article>`;
  }

  function render() {
    const all = items.length;
    const pub = items.filter(x => stateOf(x) === 'published').length;
    $('#count-all').textContent = all;
    $('#count-published').textContent = pub;
    $('#count-unpublished').textContent = all - pub;

    const shown = visibleItems();
    if (!shown.length) {
      listRoot.innerHTML = '<div class="empty">この条件のレビュー記事はありません。</div>';
      return;
    }

    const groups = new Map();
    for (const item of shown) {
      const key = fmtDate(item.review_date || item.source_published_at || item.evaluated_at || item.discovered_at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    listRoot.innerHTML = [...groups.entries()].map(([day, rows]) => `
      <section class="day-group">
        <div class="day-head" role="button" tabindex="0"><strong>${esc(day)}</strong><span class="day-count">${rows.length}件</span></div>
        <div class="day-body">${rows.map(rowHtml).join('')}</div>
      </section>`).join('');

    listRoot.querySelectorAll('.day-head').forEach(head => {
      const toggle = () => { head.nextElementSibling.hidden = !head.nextElementSibling.hidden; };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });

    listRoot.querySelectorAll('.state-btn').forEach(btn => {
      btn.addEventListener('click', () => togglePublication(btn));
    });
  }

  async function loadQueue() {
    status.textContent = 'レビュー記事を読み込んでいます…';
    const rows = await api('nyu_admin_review_queue?select=*&order=review_date.desc,score_total.desc');
    items = rows || [];
    status.textContent = `70〜79点のレビュー対象 ${items.length}件`;
    render();
  }

  async function togglePublication(btn) {
    const row = btn.closest('.review-row');
    const id = row?.dataset.id;
    const publish = btn.dataset.action === 'publish';
    if (!id) return;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '更新中…';
    status.textContent = publish ? '公開処理中…' : '非公開処理中…';
    try {
      await api('rpc/nyu_set_review_publication', {
        method: 'POST',
        body: { p_evaluation_id: id, p_publish: publish }
      });
      await loadQueue();
      status.textContent = publish ? '公開しました。' : '非公開にしました。';
    } catch (err) {
      status.textContent = `更新できませんでした：${err.message}`;
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  async function showAdmin(user) {
    loginPanel.hidden = true;
    setupPanel.hidden = true;
    reviewApp.hidden = false;
    logoutBtn.hidden = false;
    userLabel.textContent = user.email || '管理者';
    await loadQueue();
  }

  async function boot() {
    loadSavedSession();
    if (!session) return showLogin();
    try {
      const user = await getCurrentUser();
      if (!user) return showLogin();
      if (!(await isAdmin(user.id))) return showSetup(user);
      await showAdmin(user);
    } catch (err) {
      console.error(err);
      clearSession();
      showLogin();
      loginMessage.textContent = 'セッションを確認できませんでした。もう一度ログインしてください。';
    }
  }

  loginForm?.addEventListener('submit', async e => {
    e.preventDefault();
    loginMessage.textContent = 'ログイン中…';
    try {
      await signIn($('#email').value.trim(), $('#password').value);
      const user = await getCurrentUser();
      if (!user) throw new Error('ユーザー情報を取得できませんでした');
      loginMessage.textContent = '';
      if (!(await isAdmin(user.id))) showSetup(user);
      else await showAdmin(user);
    } catch (err) {
      loginMessage.textContent = err.message;
    }
  });

  logoutBtn?.addEventListener('click', signOut);
  $('#copy-sql-btn')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText($('#bootstrap-sql').textContent || '');
    $('#copy-sql-btn').textContent = 'コピーしました';
  });

  document.querySelectorAll('.filter').forEach(btn => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === btn));
      render();
    });
  });

  boot();
})();
