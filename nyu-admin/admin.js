(() => {
  const CFG = window.ZENNEWS_CONFIG;
  if (!CFG?.supabaseUrl || !CFG?.publishableKey) {
    document.body.innerHTML = '<p style="padding:24px">設定を読み込めませんでした。</p>';
    return;
  }

  const authBase = `${CFG.supabaseUrl}/auth/v1`;
  const restBase = `${CFG.supabaseUrl}/rest/v1`;
  const sessionKey = 'nyu_admin_session_v1';
  const legacySessionKey = 'zennyu_admin_session_v1';
  const BRAND_UI = {
    zen: {
      name: 'ぜんにゅー',
      reviewLabel: '70-79点',
      featuredLabel: 'いま読みたい善兆',
      commentLabel: '善兆コメント',
      reasonLabel: 'なぜこの点数か',
      autoLabel: '自動掲載圏'
    },
    dou: {
      name: 'どうにゅー',
      reviewLabel: '要確認',
      featuredLabel: '注目導調',
      commentLabel: '導調コメント',
      reasonLabel: 'なぜこの評価か',
      autoLabel: '自動掲載圏'
    }
  };

  let session = null;
  let brands = [];
  let activeBrand = new URLSearchParams(location.search).get('brand') || 'zen';
  let items = [];
  let filter = 'all';
  let dateFilter = '';
  let currentFeatured = null;

  const $ = sel => document.querySelector(sel);
  const loginPanel = $('#login-panel');
  const setupPanel = $('#setup-panel');
  const reviewApp = $('#review-app');
  const loginForm = $('#login-form');
  const loginMessage = $('#login-message');
  const userLabel = $('#user-label');
  const logoutBtn = $('#logout-btn');
  const listRoot = $('#review-list');
  const status = $('#status');
  const inboxNotification = $('#inbox-notification');
  const inboxBadge = $('#inbox-unread-badge');
  let inboxCheckInFlight = false;
  async function refreshInboxNotification() {
    if (!inboxNotification || reviewApp.hidden || document.hidden || inboxCheckInFlight) return;
    inboxCheckInFlight = true;
    try {
      // Only the current zennyu project's "new" inquiries are notification-worthy.
      // The admin's existing authenticated Supabase session and RLS protect this request.
      const rows = await api('project_inbox_inquiries?select=id,project_inbox_projects!inner(code)&project_inbox_projects.code=eq.zennyu&status=eq.new');
      const count = rows.length;
      inboxBadge.textContent = count > 99 ? '99+' : String(count);
      inboxBadge.hidden = count === 0;
      inboxNotification.classList.toggle('has-new', count > 0);
      inboxNotification.title = count ? `ぜんにゅー：未対応のお問い合わせ ${count}件` : 'ぜんにゅー：未対応のお問い合わせはありません';
      inboxNotification.setAttribute('aria-label', inboxNotification.title + '。Project Inboxを開く');
    } catch (err) {
      // Do not present an incorrect zero when the network or session has failed.
      inboxBadge.hidden = true;
      inboxNotification.classList.remove('has-new');
      inboxNotification.title = 'Project Inbox（通知状況を取得できません）';
      console.warn('Inbox notification unavailable:', err);
    } finally {
      inboxCheckInFlight = false;
    }
  }
  function showInboxIcon(show) {
    if (!inboxNotification) return;
    inboxNotification.hidden = !show;
    if (show) refreshInboxNotification();
  }
  // A lightweight check is enough here; no paid APIs or push infrastructure.
  setInterval(refreshInboxNotification, 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshInboxNotification();
  });


  const ui = () => BRAND_UI[activeBrand] || {
    name: brands.find(b => b.slug === activeBrand)?.name || activeBrand,
    reviewLabel: '要確認', featuredLabel: '注目記事', commentLabel: '編集コメント', reasonLabel: '判定理由', autoLabel: '自動掲載圏'
  };

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
    localStorage.removeItem(legacySessionKey);
  }

  function loadSavedSession() {
    try {
      const raw = localStorage.getItem(sessionKey) || localStorage.getItem(legacySessionKey);
      const data = JSON.parse(raw || 'null');
      if (data?.access_token && data?.refresh_token) {
        session = data;
        localStorage.setItem(sessionKey, JSON.stringify(data));
      }
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
    saveSession(await res.json());
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
    if (res.status === 401 && await refreshSession()) return api(path, { method, body, prefer });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(data?.message || data?.hint || data?.error || `API ${res.status}`);
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
  }

  async function signOut() {
    if (session?.access_token) {
      try {
        await fetch(`${authBase}/logout`, {
          method:'POST',
          headers:{ apikey:CFG.publishableKey, Authorization:`Bearer ${session.access_token}` }
        });
      } catch {}
    }
    clearSession();
    location.reload();
  }

  async function getCurrentUser() {
    if (!(await ensureSession())) return null;
    const res = await fetch(`${authBase}/user`, {
      headers:{ apikey:CFG.publishableKey, Authorization:`Bearer ${session.access_token}` }
    });
    if (!res.ok) return null;
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
    showInboxIcon(false);
  }

  function showSetup(user) {
    loginPanel.hidden = true;
    setupPanel.hidden = false;
    reviewApp.hidden = true;
    logoutBtn.hidden = false;
    userLabel.textContent = user.email || 'ログイン済み';
    showInboxIcon(false);
    $('#bootstrap-sql').textContent = `insert into public.nyu_admin_users (user_id, role, is_active)\nvalues ('${user.id}', 'owner', true)\non conflict (user_id) do update\nset role = 'owner', is_active = true, updated_at = now();`;
  }

  function fmtDate(v) {
    if (!v) return '日付不明';
    return new Intl.DateTimeFormat('ja-JP', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).format(new Date(v));
  }

  function jstDateKey(v) {
    if (!v) return '';
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v));
    const get = type => parts.find(p => p.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  function stateOf(item) { return item.article_status === 'published' ? 'published' : 'unpublished'; }
  function isFeatured(item) { return Boolean(currentFeatured?.id && item.article_id === currentFeatured.id); }
  function isReviewBand(item) { const n=Number(item.score_total); return Number.isFinite(n) && n >= 70 && n <= 79; }

  // Review-only items and unpublished 70-79 items have a 14-day editorial shelf life.
  // Published articles and 80+ scores are not subject to this queue retention rule.
  function retainedForEditorial(item) {
    if (!isReviewBand(item) || stateOf(item)==='published') return true;
    const date = item.article_id
      ? (item.unpublished_at || item.evaluated_at || item.review_date)
      : (item.evaluated_at || item.review_date);
    const timestamp = date ? new Date(date).getTime() : NaN;
    return Number.isFinite(timestamp) && timestamp >= Date.now() - 14*86400000;
  }

  function visibleItems() {
    let list = [...items];
    if (filter === 'published') list = list.filter(x => stateOf(x) === 'published');
    if (filter === 'unpublished') list = list.filter(x => stateOf(x) === 'unpublished');
    if (filter === 'review') list = list.filter(isReviewBand);
    if (filter === 'featured') list = list.filter(isFeatured);
    if (dateFilter) list = list.filter(x => jstDateKey(x.source_published_at || x.review_date) === dateFilter);
    return list;
  }

  function scoreHint(item) {
    if (item.luna_draft_id) return item.editorial_status==='approved_by_editor'?'Luna・編集承認済み':item.editorial_status==='rejected_by_editor'?'Luna・差し戻し':'Luna・編集確認待ち';
    if (item.score_total == null) return '公開記事';
    const n = Number(item.score_total);
    if (n >= 80) return ui().autoLabel;
    if (n === 79) return '自動掲載まであと1点';
    return `自動掲載まであと${80 - n}点`;
  }

  function rowHtml(item) {
    const published = stateOf(item) === 'published';
    const featured = isFeatured(item);
    const pinned = featured && currentFeatured?.selection_method === 'manual_pin';
    const detailSummary = item.event_summary || item.source_summary || '要約情報はありません。';
    const reason = item.suggested_reason || item.gate_reason || '判定理由はありません。';
    const title = item.suggested_title || item.source_title || '無題';
    const articleAction = item.luna_draft_id
      ? `<span class="small">${item.editorial_status==='approved_by_editor'?'編集承認済み（未公開）':item.editorial_status==='rejected_by_editor'?'差し戻し中':'公開前の編集確認待ち'}</span>`
      : item.article_id
      ? `<button class="state-btn ${published ? 'unpublish' : ''}" type="button" data-action="${published ? 'unpublish-article' : 'publish-article'}">${published ? '非公開にする' : '公開する'}</button>`
      : `<button class="state-btn" type="button" data-action="publish-review">公開する</button>`;
    const pinAction = published && item.article_id
      ? `<button class="pin-btn ${pinned ? 'active' : ''}" type="button" data-action="${pinned ? 'unpin' : 'pin'}">${pinned ? '固定解除' : 'トップに固定'}</button>` : '';

    const lunaExtras = item.luna_draft_id ? `
      <div><b>記事本文（編集可能）</b><textarea data-luna-field="article_body" rows="8" style="width:100%;box-sizing:border-box;font:inherit">${esc(item.article_body||'')}</textarea></div>
      <div><b>タイトル（編集可能）</b><textarea data-luna-field="headline" rows="2" style="width:100%;box-sizing:border-box;font:inherit">${esc(item.headline||'')}</textarea></div>
      <div><b>${esc(ui().commentLabel)}（編集可能）</b><textarea data-luna-field="zencho_comment" rows="3" style="width:100%;box-sizing:border-box;font:inherit">${esc(item.zencho_comment||'')}</textarea></div>
      <div><b>なぜ善兆なのか（編集可能）</b><textarea data-luna-field="zencho_reason" rows="4" style="width:100%;box-sizing:border-box;font:inherit">${esc(item.zencho_reason||'')}</textarea></div>
      <div><b>原稿チェックと編集状態</b>${esc(item.quality_status||'未検査')} / ${esc(item.editorial_status||'未審査')}<br><span class="small">機械検証の通過は最終事実確認ではありません。原稿修正後は再検証が必要です。</span></div>
      <div><b>確認用メモ</b><textarea data-luna-field="review_note" rows="2" style="width:100%;box-sizing:border-box;font:inherit" placeholder="承認・差し戻しの理由を記入">${esc(item.review_note||'')}</textarea></div>
      <div><b>根拠引用</b><details><summary>${Array.isArray(item.evidence_claims)?item.evidence_claims.length:0}件の引用を確認</summary>${(Array.isArray(item.evidence_claims)?item.evidence_claims:[]).map(c=>`<p><strong>${esc(c.claim)}</strong><br><span class="small">出典：「${esc(c.quote)}」</span></p>`).join('')}</details></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="ghost" type="button" data-action="luna-save">原稿を保存</button><button class="ghost" type="button" data-action="luna-recheck">根拠を再検証</button><button class="primary" type="button" data-action="luna-approve" ${item.quality_status!=='structural_pass'?'disabled title="再検証を通過してください"':''}>編集承認</button><button class="ghost" type="button" data-action="luna-reject">差し戻す</button><button class="ghost" type="button" data-action="luna-reopen">確認待ちに戻す</button></div>
      <p class="small" style="margin-top:8px">※Luna記事の一般公開は無効です。編集承認とサイト公開は別操作です。</p>
      ` : '';
    return `<article class="review-row ${featured ? 'is-featured' : ''}" data-key="${esc(item.item_key)}" data-article-id="${esc(item.article_id || '')}" data-evaluation-id="${esc(item.evaluation_id || '')}" data-luna-draft-id="${esc(item.luna_draft_id || '')}">
      <div class="score ${item.score_total == null ? 'na' : ''}">${item.score_total == null ? '－' : esc(item.score_total)}<small>${esc(scoreHint(item))}</small></div>
      <div class="summary-title">${esc(title)}<div class="title-badges">${featured ? `<span class="mini-badge featured">${esc(ui().featuredLabel)}</span>` : ''}</div></div>
      <div class="source-title"><b>${esc(item.source_name || '')}</b><br>${item.source_url ? `<a href="${esc(item.source_url)}" target="_blank" rel="noopener noreferrer">${esc(item.source_title || '元ニュース')}</a>` : esc(item.source_title || '元ニュース情報なし')}</div>
      <div><span class="cat">${esc(item.category_label || '－')}</span></div>
      <div class="actions"><span class="state-label ${published ? 'published' : 'unpublished'}">${published ? '公開中' : '非公開'}</span>${articleAction}${pinAction}</div>
      <details class="details"><summary>詳細を見る</summary><div class="detail-box"><div class="detail-grid">
        <div><b>元ニュース日</b>${esc(fmtDate(item.source_published_at || item.review_date))}</div>
        <div><b>要約</b>${esc(detailSummary)}</div>
        <div><b>${esc(ui().reasonLabel)}</b>${esc(reason)}</div>
        <div><b>${esc(ui().commentLabel)}</b>${esc(item.suggested_comment || '未作成')}</div>
        <div><b>スコア内訳</b>${item.score_total == null ? '評価情報なし' : `共通 ${esc(item.score_common)} / 60　カテゴリ ${esc(item.score_category)} / 40`}</div>
      </div>${lunaExtras}</div></details>
    </article>`;
  }

  function renderFeaturedStatus() {
    const box = $('#featured-status');
    const label = ui().featuredLabel;
    if (!currentFeatured) {
      box.className = 'panel featured-status auto';
      box.innerHTML = `<div class="featured-copy"><div class="featured-label">${esc(label)}</div><div class="featured-title">現在の記事を取得できませんでした。</div></div>`;
      return;
    }
    const pinned = currentFeatured.selection_method === 'manual_pin';
    box.className = `panel featured-status ${pinned ? 'pinned' : 'auto'}`;
    box.innerHTML = `<div class="featured-copy"><div class="featured-label">${pinned ? '📌 固定中' : '自動選出中'} ｜ ${esc(label)}</div><div class="featured-title">${esc(currentFeatured.title)}</div><div class="featured-meta">${pinned ? `固定解除までこの${esc(label)}を優先表示します。自動選出は裏で継続します。` : '24時間ごとの自動選出です。'}</div></div>${pinned ? '<button id="top-unpin-btn" class="pin-btn active" type="button">固定解除</button>' : ''}`;
    $('#top-unpin-btn')?.addEventListener('click', () => setPin(currentFeatured.id, false));
  }

  function render() {
    const all = items.length;
    const pub = items.filter(x => stateOf(x) === 'published').length;
    $('#count-all').textContent = all;
    $('#count-published').textContent = pub;
    $('#count-unpublished').textContent = all - pub;
    $('#count-review').textContent = items.filter(isReviewBand).length;
    renderFeaturedStatus();

    const shown = visibleItems();
    if (!shown.length) {
      listRoot.innerHTML = '<div class="empty">この条件の記事はありません。</div>';
      return;
    }
    const groups = new Map();
    for (const item of shown) {
      const key = fmtDate(item.source_published_at || item.review_date || item.evaluated_at || item.discovered_at);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    listRoot.innerHTML = [...groups.entries()].map(([day, rows]) => `<section class="day-group"><div class="day-head" role="button" tabindex="0"><strong>${esc(day)}</strong><span class="day-count">${rows.length}件</span></div><div class="day-body">${rows.map(rowHtml).join('')}</div></section>`).join('');
    listRoot.querySelectorAll('.day-head').forEach(head => {
      const toggle = () => { head.nextElementSibling.hidden = !head.nextElementSibling.hidden; };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });
    listRoot.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => handleAction(btn)));
  }

  function applyBrandUi() {
    const info = ui();
    $('#brand-heading').textContent = `${info.name} 記事管理`;
    $('#review-stat-label').textContent = info.reviewLabel;
    $('#review-filter-label').textContent = info.reviewLabel;
    $('#featured-filter-label').textContent = info.featuredLabel;
    document.title = `${info.name}｜NYUNET 管理`;
  }

  async function loadBrands() {
    brands = await api('nyu_brands?select=id,slug,name,is_active&is_active=eq.true&order=name.asc');
    if (!brands.some(b => b.slug === activeBrand)) activeBrand = brands[0]?.slug || 'zen';
    const select = $('#brand-select');
    select.innerHTML = brands.map(b => `<option value="${esc(b.slug)}" ${b.slug===activeBrand?'selected':''}>${esc(b.name)}</option>`).join('');
    select.disabled = brands.length <= 1;
    applyBrandUi();
  }

  async function loadFeatured() {
    const rows = await api(`nyu_public_daily_featured?select=*&brand_slug=eq.${encodeURIComponent(activeBrand)}&order=feature_date.desc&limit=1`);
    currentFeatured = rows?.[0] || null;
  }

  async function loadQueue() {
    status.textContent = '記事を読み込んでいます…';
    const [rows, lunaRows] = await Promise.all([
      api(`nyu_admin_article_catalog?select=*&brand_slug=eq.${encodeURIComponent(activeBrand)}&order=review_date.desc.nullslast,score_total.desc.nullslast`),
      activeBrand==='zen' ? api('nyu_admin_luna_editorial_desk?select=*&score_total=gte.80&order=scored_at.desc&limit=100') : Promise.resolve([])
    ]);
    await loadFeatured();
    const codes={good:'善',forward:'前',nature:'然',repair:'繕',mind:'禅',food:'膳'};
    const lunaItems=(lunaRows||[]).filter(x=>x.draft_id && x.editorial_status!=='rejected_by_editor').map(x=>({
      item_key:'luna:'+x.draft_id,luna_draft_id:x.draft_id,
      article_id:null,evaluation_id:null,source_item_id:x.source_item_id,
      score_total:x.score_total,score_common:x.score_common,score_category:x.score_category,
      suggested_title:x.headline||x.source_title,suggested_comment:x.zencho_comment,
      suggested_reason:x.zencho_reason,source_title:x.source_title,source_url:x.source_url,
      source_published_at:x.source_published_at,source_name:x.publisher,
      event_summary:x.event_summary,gate_reason:x.scoring_note,
      category_code:x.category_code,category_label:codes[x.category_code]||x.category_code,
      article_status:'unpublished',review_only:true,
      review_date:x.draft_created_at||x.scored_at,
      headline:x.headline,article_body:x.article_body,
      zencho_comment:x.zencho_comment,zencho_reason:x.zencho_reason,
      evidence_claims:x.evidence_claims,quality_status:x.quality_status,
      editorial_status:x.editorial_status,review_note:x.review_note
    }));
    // Luna drafts have their own immutable score ID; never map them to legacy evaluation IDs.
    items=[...(rows||[]),...lunaItems].filter(retainedForEditorial)
       .sort((a,b)=>new Date(b.review_date||0)-new Date(a.review_date||0));
    status.textContent = `${ui().name}：${items.length}件を表示できます。`;
    render();
  }

  async function apiLunaRecheck(draftId) {
    if (!session?.access_token) throw new Error('ログインし直してください。');
    const r=await fetch(`${CFG.supabaseUrl}/functions/v1/nyu-luna-publication-draft`,{
      method:'POST',
      headers:{'Content-Type':'application/json',apikey:CFG.publishableKey,Authorization:`Bearer ${session.access_token}`},
      body:JSON.stringify({mode:'recheck_saved',draft_id:draftId})
    });
    const data=await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error||'再検証に失敗しました');
    if (!data.results?.length) throw new Error('確認待ち原稿が見つかりません');
    return data;
  }

  async function setPin(articleId, pin, reload=true) {
    if (!articleId) return;
    await api('rpc/nyu_set_featured_pin', { method:'POST', body:{ p_article_id:articleId, p_pin:pin } });
    if (reload) {
      await loadQueue();
      status.textContent = pin ? `${ui().featuredLabel}に固定しました。` : '固定を解除しました。自動選出へ戻りました。';
    }
  }

  async function handleAction(btn) {
    const row = btn.closest('.review-row');
    const articleId = row?.dataset.articleId;
    const evaluationId = row?.dataset.evaluationId;
    const action = btn.dataset.action;
    if (!action) return;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '更新中…';
    try {
      if (action.startsWith('luna-')) {
        const draftId=row?.dataset.lunaDraftId;
        if (!draftId) throw new Error('Luna原稿IDがありません');
        if (action==='luna-recheck') {
          const res=await apiLunaRecheck(draftId);
          if (!res.ok) throw new Error(res.error||'検証できませんでした');
          status.textContent='原稿を再検証しました。';
        } else {
          const get=k=>row.querySelector('[data-luna-field="'+k+'"]')?.value||'';
          const actions={'luna-save':'save','luna-approve':'approve','luna-reject':'reject','luna-reopen':'reopen'};
          const kind=actions[action];
          if (!kind) throw new Error('未対応操作');
          const note=get('review_note').trim();
          if (kind==='approve' && !confirm('原文・数値・権利・表現を確認し、編集承認しますか？（サイトには公開されません）')) {
            btn.disabled=false;btn.textContent=oldText;return;
          }
          if (kind==='reject' && !confirm('このLuna原稿を差し戻しますか？')) {
            btn.disabled=false;btn.textContent=oldText;return;
          }
          await api('rpc/nyu_manage_luna_editorial',{method:'POST',body:{
            p_draft_id:draftId,p_action:kind,p_note:note||null,
            p_headline:kind==='save'?get('headline'):null,
            p_article_body:kind==='save'?get('article_body'):null,
            p_zencho_comment:kind==='save'?get('zencho_comment'):null,
            p_zencho_reason:kind==='save'?get('zencho_reason'):null
          }});
          status.textContent=kind==='save'?'原稿を保存しました。再検証後に編集承認できます。':kind==='approve'?'編集承認しました（未公開）。':kind==='reject'?'差し戻しました。':'確認待ちに戻しました。';
        }
      } else if (action === 'publish-review') {
        await api('rpc/nyu_set_review_publication', { method:'POST', body:{ p_evaluation_id:evaluationId, p_publish:true } });
        status.textContent = '公開しました。';
      } else if (action === 'publish-article' || action === 'unpublish-article') {
        await api('rpc/nyu_set_article_publication', { method:'POST', body:{ p_article_id:articleId, p_publish:action === 'publish-article' } });
        status.textContent = action === 'publish-article' ? '公開しました。' : '非公開にしました。';
      } else if (action === 'pin') {
        const pinnedNow = currentFeatured?.selection_method === 'manual_pin' ? currentFeatured : null;
        if (pinnedNow && pinnedNow.id !== articleId) {
          const nextTitle = row.querySelector('.summary-title')?.childNodes?.[0]?.textContent?.trim() || 'この記事';
          if (!confirm(`現在「${pinnedNow.title}」が固定されています。\n\n「${nextTitle}」に固定記事を変更しますか？`)) {
            btn.disabled = false; btn.textContent = oldText; return;
          }
        }
        await setPin(articleId, true, false);
        status.textContent = `${ui().featuredLabel}に固定しました。`;
      } else if (action === 'unpin') {
        await setPin(articleId, false, false);
        status.textContent = '固定を解除しました。自動選出へ戻りました。';
      }
      await loadQueue();
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
    showInboxIcon(true);
    await loadBrands();
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
      if (!(await isAdmin(user.id))) showSetup(user); else await showAdmin(user);
    } catch (err) { loginMessage.textContent = err.message; }
  });

  logoutBtn?.addEventListener('click', signOut);
  $('#copy-sql-btn')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText($('#bootstrap-sql').textContent || '');
    $('#copy-sql-btn').textContent = 'コピーしました';
  });
  document.querySelectorAll('.filter').forEach(btn => btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x === btn));
    render();
  }));
  $('#date-filter')?.addEventListener('change', e => { dateFilter = e.target.value || ''; render(); });
  $('#clear-date-btn')?.addEventListener('click', () => { dateFilter=''; $('#date-filter').value=''; render(); });
  $('#brand-select')?.addEventListener('change', async e => {
    activeBrand = e.target.value;
    filter = 'all';
    dateFilter = '';
    $('#date-filter').value = '';
    document.querySelectorAll('.filter').forEach(x => x.classList.toggle('active', x.dataset.filter === 'all'));
    history.replaceState(null, '', `${location.pathname}?brand=${encodeURIComponent(activeBrand)}`);
    applyBrandUi();
    await loadQueue();
  });

  boot();
})();