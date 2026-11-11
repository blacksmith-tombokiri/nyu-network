(()=>{
  const root=document.querySelector('#popular-list');
  if(!root)return;
  const CFG=window.ZENNEWS_CONFIG;
  const apiBase=`${CFG.supabaseUrl}/rest/v1`;
  const headers={apikey:CFG.publishableKey,Accept:'application/json'};
  const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const codes=['good','forward','nature','repair','mind','food'];
  const cls=code=>codes.includes(code)?code:'forward';
  const articleUrl=id=>`article.html?id=${encodeURIComponent(id)}`;
  async function load(){
    const qs=new URLSearchParams({select:'*',brand_slug:`eq.${CFG.brandSlug}`,order:'popular_rank.asc',limit:'10'});
    const res=await fetch(`${apiBase}/nyu_public_popular_articles?${qs}`,{headers,cache:'no-store'});
    if(!res.ok)throw new Error(`API ${res.status}`);
    return res.json();
  }
  function card(a){
    const rank=String(a.popular_rank||'').padStart(2,'0');
    const code=cls(a.primary_category_code);
    const label=a.primary_category_label||'善兆';
    const thumb=a.image_url
      ? `<div class="popular-thumb story-thumb"><img src="${esc(a.image_url)}" alt=""><span class="story-badge">${esc(label)}</span></div>`
      : `<div class="popular-thumb story-thumb visual-${code}" data-mark="${esc(label)}"><span class="story-badge">${esc(label)}</span></div>`;
    return `<a class="popular-card" href="${articleUrl(a.public_id)}"><div class="popular-rank">${rank}</div>${thumb}<div><div class="popular-title">${esc(a.title)}</div>${a.editorial_comment?`<div class="popular-summary">${esc(a.editorial_comment)}</div>`:''}</div></a>`;
  }
  load().then(items=>{
    root.innerHTML=items.length?items.map(card).join(''):'<p class="muted">ランキングを集計中です。</p>';
  }).catch(err=>{
    console.error(err);
    root.innerHTML='<p class="muted">ランキングを読み込めませんでした。</p>';
  });
})();
