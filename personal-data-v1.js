(()=>{
  const FAVORITES_KEY='zennyu_favorites_v1';
  const REACTION_HISTORY_KEY='zennyu_reaction_history_v1';
  const PUBLIC_ID_RE=/^[23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/;
  const VALID_REACTIONS=new Set(['support','try','spread','learn']);
  const REACTION_LABELS={support:'👏 応援したい',try:'✨ 試してみたい',spread:'💡 広がってほしい',learn:'🔎 もっと知りたい'};
  const CFG=window.ZENNEWS_CONFIG;

  const esc=(v='')=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function readFavorites(){
    try{
      const data=JSON.parse(localStorage.getItem(FAVORITES_KEY)||'[]');
      if(!Array.isArray(data))return[];
      return [...new Set(data.filter(v=>typeof v==='string'&&PUBLIC_ID_RE.test(v.trim())).map(v=>v.trim()))];
    }catch{return[]}
  }

  function writeFavorites(ids){
    const clean=[...new Set((ids||[]).filter(v=>typeof v==='string'&&PUBLIC_ID_RE.test(v.trim())).map(v=>v.trim()))];
    localStorage.setItem(FAVORITES_KEY,JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent('zennyu:favorites-changed'));
    return clean;
  }

  function readHistory(){
    try{
      const raw=JSON.parse(localStorage.getItem(REACTION_HISTORY_KEY)||'{}');
      if(!raw||typeof raw!=='object'||Array.isArray(raw))return{};
      const out={};
      for(const [publicId,item] of Object.entries(raw)){
        if(!PUBLIC_ID_RE.test(publicId)||!item||typeof item!=='object')continue;
        const types=[...new Set((Array.isArray(item.active_types)?item.active_types:[]).filter(t=>VALID_REACTIONS.has(t)))];
        if(!types.length)continue;
        out[publicId]={active_types:types,updated_at:typeof item.updated_at==='string'?item.updated_at:new Date().toISOString()};
      }
      return out;
    }catch{return{}}
  }

  function writeHistory(history){
    const clean={};
    for(const [publicId,item] of Object.entries(history||{})){
      if(!PUBLIC_ID_RE.test(publicId)||!item||typeof item!=='object')continue;
      const types=[...new Set((Array.isArray(item.active_types)?item.active_types:[]).filter(t=>VALID_REACTIONS.has(t)))];
      if(!types.length)continue;
      clean[publicId]={active_types:types,updated_at:typeof item.updated_at==='string'?item.updated_at:new Date().toISOString()};
    }
    localStorage.setItem(REACTION_HISTORY_KEY,JSON.stringify(clean));
    window.dispatchEvent(new CustomEvent('zennyu:reaction-history-changed'));
    return clean;
  }

  function captureArticleReactionState(publicId){
    if(!PUBLIC_ID_RE.test(publicId))return;
    const buttons=[...document.querySelectorAll('.reaction-btn[data-reaction]')];
    if(!buttons.length)return;
    const active=buttons.filter(btn=>btn.getAttribute('aria-pressed')==='true'||btn.classList.contains('active')).map(btn=>btn.dataset.reaction).filter(t=>VALID_REACTIONS.has(t));
    const history=readHistory();
    if(active.length)history[publicId]={active_types:[...new Set(active)],updated_at:new Date().toISOString()};
    else delete history[publicId];
    writeHistory(history);
  }

  function setupArticleCapture(){
    const root=document.querySelector('#article-app');
    if(!root)return;
    const params=new URLSearchParams(location.search);
    const publicId=params.get('id')||params.get('public_id')||'';
    if(!PUBLIC_ID_RE.test(publicId))return;
    let bound=false;
    const bind=()=>{
      const buttons=[...root.querySelectorAll('.reaction-btn[data-reaction]')];
      if(!buttons.length)return;
      if(!bound){
        bound=true;
        buttons.forEach(btn=>btn.addEventListener('click',()=>{
          setTimeout(()=>captureArticleReactionState(publicId),250);
          setTimeout(()=>captureArticleReactionState(publicId),900);
        }));
      }
      setTimeout(()=>captureArticleReactionState(publicId),700);
    };
    bind();
    new MutationObserver(bind).observe(root,{childList:true,subtree:true});
  }

  function fmtDate(v){
    if(!v)return'';
    const d=new Date(v);
    if(Number.isNaN(d.getTime()))return'';
    return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tokyo'}).format(d);
  }

  async function fetchPublicArticles(){
    if(!CFG?.supabaseUrl||!CFG?.publishableKey)return[];
    const qs=new URLSearchParams({select:'public_id,title,published_at,primary_category_label',brand_slug:`eq.${CFG.brandSlug}`,order:'published_at.desc.nullslast'});
    const res=await fetch(`${CFG.supabaseUrl}/rest/v1/nyu_public_articles?${qs}`,{headers:{apikey:CFG.publishableKey,Accept:'application/json'}});
    if(!res.ok)throw new Error(`API ${res.status}`);
    return res.json();
  }

  function downloadJson(data){
    const stamp=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',timeZone:'Asia/Tokyo'}).format(new Date());
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`zennyu-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function makeExport(){
    return{
      format:'zennyu-personal-data',
      version:1,
      exported_at:new Date().toISOString(),
      favorites:readFavorites(),
      reaction_history:readHistory()
    };
  }

  function validateImport(data){
    if(!data||typeof data!=='object'||data.format!=='zennyu-personal-data'||data.version!==1)throw new Error('ぜんにゅーのバックアップファイルではありません。');
    const favorites=Array.isArray(data.favorites)?data.favorites:[];
    const reactionHistory=data.reaction_history&&typeof data.reaction_history==='object'&&!Array.isArray(data.reaction_history)?data.reaction_history:{};
    return{favorites,reactionHistory};
  }

  function mergeImport(data){
    const {favorites,reactionHistory}=validateImport(data);
    const mergedFavorites=writeFavorites([...readFavorites(),...favorites]);
    const current=readHistory();
    const incoming=writeHistory(reactionHistory);
    for(const [publicId,item] of Object.entries(incoming)){
      const existing=current[publicId];
      current[publicId]={
        active_types:[...new Set([...(existing?.active_types||[]),...item.active_types])],
        updated_at:[existing?.updated_at,item.updated_at].filter(Boolean).sort().at(-1)||new Date().toISOString()
      };
    }
    const mergedHistory=writeHistory(current);
    return{favoriteCount:mergedFavorites.length,reactionCount:Object.keys(mergedHistory).length};
  }

  function reactionRow(publicId,item,article){
    const title=article?.title||`記事 ${publicId}`;
    const meta=[fmtDate(article?.published_at),article?.primary_category_label].filter(Boolean).join(' ｜ ');
    const chips=item.active_types.map(t=>`<span class="history-chip">${esc(REACTION_LABELS[t]||t)}</span>`).join('');
    return`<article class="history-row" data-history-id="${esc(publicId)}">
      <div class="history-main">
        <div class="history-meta">${esc(meta||'公開情報を確認できません')}</div>
        ${article?`<a class="history-title" href="article.html?id=${encodeURIComponent(publicId)}">${esc(title)}</a>`:`<span class="history-title">${esc(title)}</span>`}
        <div class="history-chips">${chips}</div>
      </div>
      <button class="history-remove" type="button" data-history-remove="${esc(publicId)}">履歴から削除</button>
    </article>`;
  }

  async function renderHistory(){
    const root=document.querySelector('#reaction-history-app');
    if(!root)return;
    const history=readHistory();
    const entries=Object.entries(history).sort((a,b)=>String(b[1].updated_at||'').localeCompare(String(a[1].updated_at||'')));
    const count=document.querySelector('#reaction-history-count');
    if(count)count.textContent=String(entries.length);
    if(!entries.length){
      root.innerHTML='<div class="history-empty"><strong>まだリアクション履歴はありません。</strong><p>記事でリアクションすると、この端末の履歴としてここに表示されます。</p></div>';
      return;
    }
    root.innerHTML='<p class="muted">履歴を読み込み中です。</p>';
    let articles=[];
    try{articles=await fetchPublicArticles()}catch(err){console.debug('reaction history article lookup skipped',err)}
    const byId=new Map(articles.map(a=>[a.public_id,a]));
    root.innerHTML=entries.map(([id,item])=>reactionRow(id,item,byId.get(id))).join('');
    root.querySelectorAll('[data-history-remove]').forEach(btn=>btn.addEventListener('click',()=>{
      const id=btn.dataset.historyRemove;
      const next=readHistory();
      delete next[id];
      writeHistory(next);
      renderHistory();
      setNotice('この端末の履歴から削除しました。公開リアクション数は変更していません。','ok');
    }));
  }

  function setNotice(text,type=''){
    const el=document.querySelector('#personal-data-notice');
    if(!el)return;
    el.textContent=text;
    el.className=`data-notice ${type}`.trim();
  }

  function setupDataTools(){
    const exportBtn=document.querySelector('#export-personal-data');
    const importBtn=document.querySelector('#import-personal-data');
    const input=document.querySelector('#import-personal-file');
    const clearBtn=document.querySelector('#clear-personal-data');
    if(!exportBtn&&!importBtn&&!clearBtn)return;

    exportBtn?.addEventListener('click',()=>{
      downloadJson(makeExport());
      setNotice('お気に入りとリアクション履歴を書き出しました。','ok');
    });
    importBtn?.addEventListener('click',()=>input?.click());
    input?.addEventListener('change',async()=>{
      const file=input.files?.[0];
      if(!file)return;
      try{
        const data=JSON.parse(await file.text());
        const result=mergeImport(data);
        setNotice(`復元しました。お気に入り ${result.favoriteCount}件、リアクション履歴 ${result.reactionCount}件です。`,'ok');
        renderHistory();
      }catch(err){
        setNotice(err?.message||'インポートできませんでした。','error');
      }finally{input.value=''}
    });
    clearBtn?.addEventListener('click',()=>{
      if(!confirm('この端末のお気に入りとリアクション履歴をすべて削除します。公開リアクション数は変更されません。よろしいですか？'))return;
      writeFavorites([]);
      writeHistory({});
      renderHistory();
      setNotice('この端末の個人データを削除しました。','ok');
    });
  }

  document.addEventListener('DOMContentLoaded',()=>{
    setupArticleCapture();
    setupDataTools();
    renderHistory();
  });
})();
