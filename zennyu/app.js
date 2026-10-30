const CFG = window.ZENNEWS_CONFIG;
const apiBase = `${CFG.supabaseUrl}/rest/v1`;
const headers = {
  apikey: CFG.publishableKey,
  Accept: 'application/json'
};

const categoryNames = {
  good:'善', forward:'前', nature:'然', repair:'繕', mind:'禅', food:'膳'
};

function esc(v='') { return String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function cls(code){ return ['good','forward','nature','repair','mind','food'].includes(code) ? code : 'forward'; }
function fmtDate(v){ if(!v) return ''; return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v)); }
function primarySource(a){ return Array.isArray(a.sources) ? (a.sources.find(s=>s.primary) || a.sources[0]) : null; }
function metaText(a){ const s=primarySource(a); return [s?.name, fmtDate(a.published_at || s?.published_at)].filter(Boolean).join(' ｜ '); }
function articleUrl(slug){ return `article.html?slug=${encodeURIComponent(slug)}`; }

async function get(path, params={}){
  const qs = new URLSearchParams(params);
  const res = await fetch(`${apiBase}/${path}?${qs.toString()}`, {headers});
  if(!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function loadBrand(){
  const rows = await get('nyu_public_brand_config',{select:'*',slug:`eq.${CFG.brandSlug}`});
  return rows[0];
}
async function loadArticles(){
  return get('nyu_public_articles',{
    select:'*', brand_slug:`eq.${CFG.brandSlug}`, order:'published_at.desc.nullslast'
  });
}
async function loadCategories(){
  return get('nyu_public_categories',{
    select:'*', brand_slug:`eq.${CFG.brandSlug}`, order:'sort_order.asc'
  });
}
async function loadFeatured(){
  return get('nyu_public_featured_articles',{
    select:'*', brand_slug:`eq.${CFG.brandSlug}`, recommendation_category_id:'is.null', recommendation_rank:'eq.1', limit:'1'
  });
}

function cardHtml(a, brand){
  const code=cls(a.primary_category_code), label=a.primary_category_label || categoryNames[code] || '善兆';
  const topic = Array.isArray(a.tags) && a.tags[0]?.name ? a.tags[0].name : '善兆';
  return `<article class="card" data-category="${esc(code)}" data-search="${esc([a.title,a.summary,a.editorial_comment,primarySource(a)?.name].join(' ').toLowerCase())}">
    <a href="${articleUrl(a.slug)}">
      ${a.image_url ? `<div class="thumb"><img src="${esc(a.image_url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"><span>${esc(topic)}</span></div>` : `<div class="thumb visual-${code}" data-mark="${esc(label)}"><span>${esc(topic)}</span></div>`}
      <div class="card-body">
        <div class="tag ${code}">${esc(label)}</div>
        <h3>${esc(a.title)}</h3>
        <p class="summary">${esc(a.summary || '')}</p>
        <div class="editorial"><small>${esc(brand.editorial_comment_label || '善兆コメント')}</small>${esc(a.editorial_comment || '')}</div>
        <div class="meta">${esc(metaText(a))}</div>
      </div>
    </a>
  </article>`;
}

function renderHero(a, brand){
  const el=document.querySelector('#hero');
  if(!a){ el.innerHTML='<div class="empty">今日の善兆を選定中です。</div>'; return; }
  const code=cls(a.primary_category_code), label=a.primary_category_label || categoryNames[code];
  const source=metaText(a);
  el.innerHTML=`<article class="hero">
    <div class="hero-copy">
      <div class="section-kicker">今日の${esc(brand.editorial_concept_label || '善兆')}</div>
      <div class="tag ${code}">${esc(label)}</div>
      <h2><a href="${articleUrl(a.slug)}">${esc(a.title)}</a></h2>
      <p class="summary">${esc(a.summary || '')}</p>
      <div class="editorial"><small>${esc(brand.editorial_comment_label || '善兆コメント')}</small>${esc(a.editorial_comment || '')}</div>
      <div class="meta">${esc(source)}</div>
    </div>
    <a class="hero-visual visual-${code}" data-mark="${esc(label)}" data-caption="${esc((a.editorial_comment || '').slice(0,24))}" href="${articleUrl(a.slug)}" aria-label="${esc(a.title)}"></a>
  </article>`;
}

function shortCatDescription(c){
  const fixed={good:'助け合い・支援',forward:'技術・制度の前進',nature:'自然・環境',repair:'修復・再生',mind:'心身・暮らしを整える',food:'食の話題'};
  return fixed[c.code] || c.description || '';
}

async function initHome(){
  const root=document.querySelector('#home-app'); if(!root) return;
  try{
    const [brand,articles,categories,featured] = await Promise.all([loadBrand(),loadArticles(),loadCategories(),loadFeatured()]);
    document.querySelectorAll('[data-brand-name]').forEach(x=>x.textContent=brand?.name || 'ぜんにゅー');
    renderHero(featured[0] || articles[0], brand);
    const grid=document.querySelector('#article-grid');
    const moreBtn=document.querySelector('#more-btn');
    const filterNote=document.querySelector('#filter-note');
    let shown=6, filter='all', query='';
    const render=()=>{
      const visible=articles.filter(a=>(filter==='all'||a.primary_category_code===filter) && (!query || [a.title,a.summary,a.editorial_comment,primarySource(a)?.name].join(' ').toLowerCase().includes(query)) );
      grid.innerHTML=visible.slice(0,shown).map(a=>cardHtml(a,brand)).join('') || '<div class="empty" style="grid-column:1/-1">該当する善兆はまだありません。</div>';
      moreBtn.style.display=visible.length>shown?'inline-flex':'none';
      filterNote.hidden=(filter==='all'&&!query);
      if(!filterNote.hidden) filterNote.innerHTML=`${filter!=='all'?`「${esc(categoryNames[filter]||filter)}」`:''}${filter!=='all'&&query?' × ':''}${query?`検索「${esc(query)}」`:''} の結果 ${visible.length}件　<button id="clear-filter">解除</button>`;
      document.querySelector('#clear-filter')?.addEventListener('click',()=>{filter='all';query='';document.querySelector('#search').value='';shown=6;render();});
    };
    render();
    moreBtn.addEventListener('click',()=>{shown+=6;render();});
    document.querySelector('#search').addEventListener('input',e=>{query=e.target.value.trim().toLowerCase();shown=6;render();});
    const cats=document.querySelector('#categories-grid');
    cats.innerHTML=categories.map(c=>`<a class="cat ${cls(c.code)}" href="#new" data-cat="${esc(c.code)}"><div class="kanji">${esc(c.label)}</div><small>${esc(shortCatDescription(c))}</small><div class="count">${c.article_count}件</div></a>`).join('');
    cats.querySelectorAll('[data-cat]').forEach(a=>a.addEventListener('click',()=>{filter=a.dataset.cat;shown=6;render();}));

    const reactions=articles.map(a=>({...a,total:(a.support_count||0)+(a.try_count||0)+(a.spread_count||0)+(a.learn_count||0)})).filter(a=>a.total>0).sort((a,b)=>b.total-a.total).slice(0,5);
    const pop=document.querySelector('#popular-list');
    pop.innerHTML=reactions.length?reactions.map((a,i)=>`<a class="popular-row" href="${articleUrl(a.slug)}"><div class="num">${String(i+1).padStart(2,'0')}</div><div class="tag ${cls(a.primary_category_code)}">${esc(a.primary_category_label)}</div><strong>${esc(a.title)}</strong><span class="meta">${esc(primarySource(a)?.name||'')}</span></a>`).join(''):'<div class="empty" style="border:0;background:transparent">閲覧データが貯まったら、ここに「よく読まれている善兆」を表示します。</div>';
  }catch(err){ root.innerHTML=`<div class="wrap"><div class="error-box">実データを読み込めませんでした。${esc(err.message)}</div></div>`; console.error(err); }
}

async function initArticle(){
  const root=document.querySelector('#article-app'); if(!root) return;
  const slug=new URLSearchParams(location.search).get('slug');
  if(!slug){ root.innerHTML='<div class="article-shell"><div class="error-box">記事が指定されていません。</div></div>'; return; }
  try{
    const [brand,rows]=await Promise.all([loadBrand(),get('nyu_public_articles',{select:'*',brand_slug:`eq.${CFG.brandSlug}`,slug:`eq.${slug}`,limit:'1'})]);
    const a=rows[0]; if(!a){ root.innerHTML='<div class="article-shell"><div class="error-box">記事が見つかりません。</div></div>'; return; }
    document.title=`${a.title}｜${brand.name}`;
    const code=cls(a.primary_category_code), label=a.primary_category_label || categoryNames[code];
    const sources=(a.sources||[]).map(s=>`<div class="source-item"><div>${esc(s.name||'情報源')}</div><a href="${esc(s.url||'#')}" target="_blank" rel="noopener noreferrer">${esc(s.title||s.url||'元記事を確認')}</a>${s.published_at?`<div class="meta">${esc(fmtDate(s.published_at))}</div>`:''}</div>`).join('');
    root.innerHTML=`<div class="article-shell">
      <div class="breadcrumbs"><a href="index.html">${esc(brand.name)}</a> / ${esc(label)}</div>
      <article class="article-head">
        ${a.image_url?`<div class="article-visual"><img src="${esc(a.image_url)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></div>`:`<div class="article-visual visual-${code}" data-mark="${esc(label)}"></div>`}
        <div class="article-copy">
          <div class="tag ${code}">${esc(label)}</div>
          <h1>${esc(a.title)}</h1>
          <div class="meta">${esc(metaText(a))}</div>
          <p class="article-summary">${esc(a.summary||'')}</p>
          <div class="editorial"><small>${esc(brand.editorial_comment_label||'善兆コメント')}</small>${esc(a.editorial_comment||'')}</div>
          <div class="reason-box"><h2>${esc(brand.editorial_reason_label||'善兆理由')}</h2><div>${esc(a.editorial_reason||'')}</div></div>
          <div class="source-box"><h2>情報源</h2>${sources||'<div class="meta">情報源は登録されていません。</div>'}</div>
        </div>
      </article>
      <a class="back-link" href="index.html">← ホームへ戻る</a>
    </div>`;
  }catch(err){ root.innerHTML=`<div class="article-shell"><div class="error-box">記事を読み込めませんでした。${esc(err.message)}</div></div>`; console.error(err); }
}

document.addEventListener('DOMContentLoaded',()=>{initHome();initArticle();});
