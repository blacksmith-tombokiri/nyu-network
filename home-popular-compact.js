(()=>{
  const root=document.querySelector('#desktop-ranking-list-compact');
  if(!root)return;
  const CFG=window.ZENNEWS_CONFIG;
  const apiBase=`${CFG.supabaseUrl}/rest/v1`;
  const headers={apikey:CFG.publishableKey,Accept:'application/json'};
  const codes=['good','forward','nature','repair','mind','food'];
  const categoryNames={good:'善',forward:'前',nature:'然',repair:'繕',mind:'禅',food:'膳'};
  const gradients={
    good:'linear-gradient(145deg,#f2c5bf,#cc7c72)',
    forward:'linear-gradient(145deg,#b9cbe5,#6f8fc0)',
    nature:'linear-gradient(145deg,#b9d8ba,#6a9a70)',
    repair:'linear-gradient(145deg,#e2c4a7,#aa7548)',
    mind:'linear-gradient(145deg,#d0c7e2,#8775ad)',
    food:'linear-gradient(145deg,#eddcae,#c49b42)'
  };
  const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const cls=code=>codes.includes(code)?code:'forward';
  const articleUrl=id=>`article.html?id=${encodeURIComponent(id)}`;

  async function load(){
    const qs=new URLSearchParams({select:'*',brand_slug:`eq.${CFG.brandSlug}`,order:'popular_rank.asc',limit:'5'});
    const res=await fetch(`${apiBase}/nyu_public_popular_articles?${qs}`,{headers,cache:'no-store'});
    if(!res.ok)throw new Error(`API ${res.status}`);
    return res.json();
  }

  function card(a){
    const rank=String(a.popular_rank||'').padStart(2,'0');
    const code=cls(a.primary_category_code);
    const label=a.primary_category_label||categoryNames[code]||'善兆';
    const thumb=a.image_url
      ? `<span class="compact-article-thumb"><img src="${esc(a.image_url)}" alt=""><span class="compact-article-badge">${esc(label)}</span></span>`
      : `<span class="compact-article-thumb visual-${code}" data-category="${code}" data-mark="${esc(label)}" style="background:${gradients[code]}"><span class="compact-article-badge">${esc(label)}</span></span>`;
    return `<a class="compact-article-card" href="${articleUrl(a.public_id)}"><span class="compact-article-rank">${rank}</span>${thumb}<span class="compact-article-copy"><span class="compact-article-title">${esc(a.title)}</span><span class="compact-article-meta">${esc(label)}</span></span></a>`;
  }

  load().then(items=>{
    root.innerHTML=items.length?items.map(card).join(''):'<p class="muted">集計準備中です。</p>';
  }).catch(err=>{
    console.error(err);
    root.innerHTML='<p class="muted">ランキングを読み込めませんでした。</p>';
  });
})();
