(()=>{
  const KEY='zennyu_favorites_v1';
  const CFG=window.ZENNEWS_CONFIG;

  function esc(v=''){
    return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  function readFavorites(){
    try{
      const data=JSON.parse(localStorage.getItem(KEY)||'[]');
      if(!Array.isArray(data))return[];
      return [...new Set(data.filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))];
    }catch{return[]}
  }

  function writeFavorites(ids){
    try{localStorage.setItem(KEY,JSON.stringify([...new Set(ids)]));}catch{}
  }

  function isFavorite(publicId){
    return readFavorites().includes(publicId);
  }

  function setFavorite(publicId,on){
    const ids=readFavorites().filter(id=>id!==publicId);
    if(on)ids.unshift(publicId);
    writeFavorites(ids);
    window.dispatchEvent(new CustomEvent('zennyu:favorites-changed',{detail:{publicId,on}}));
  }

  function paintButton(btn,publicId){
    const saved=isFavorite(publicId);
    btn.classList.toggle('saved',saved);
    btn.setAttribute('aria-pressed',saved?'true':'false');
    btn.setAttribute('aria-label',saved?'お気に入りから外す':'お気に入りに保存');
    btn.innerHTML=`<span class="favorite-heart" aria-hidden="true">${saved?'♥':'♡'}</span><span>${saved?'お気に入り済み':'お気に入りに保存'}</span>`;
  }

  function setupArticleFavorite(){
    const root=document.querySelector('#article-app');
    if(!root)return;
    const params=new URLSearchParams(location.search);
    const publicId=params.get('id')||params.get('public_id');
    if(!publicId)return;

    const mount=()=>{
      const header=root.querySelector('.article-header');
      if(!header||header.querySelector('.favorite-toggle'))return;
      const actions=document.createElement('div');
      actions.className='article-favorite-actions';
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='favorite-toggle';
      paintButton(btn,publicId);
      btn.addEventListener('click',()=>{
        setFavorite(publicId,!isFavorite(publicId));
        paintButton(btn,publicId);
      });
      const link=document.createElement('a');
      link.className='favorite-list-link';
      link.href='favorites.html';
      link.textContent='お気に入りを見る';
      actions.append(btn,link);
      header.appendChild(actions);
    };

    mount();
    const observer=new MutationObserver(mount);
    observer.observe(root,{childList:true,subtree:true});
    window.addEventListener('zennyu:favorites-changed',()=>{
      const btn=root.querySelector('.favorite-toggle');
      if(btn)paintButton(btn,publicId);
    });
  }

  function categoryClass(code){
    return ['good','forward','nature','repair','mind','food'].includes(code)?code:'forward';
  }

  function articleUrl(publicId){
    return`article.html?id=${encodeURIComponent(publicId)}`;
  }

  function favoriteCard(a){
    const code=categoryClass(a.primary_category_code);
    const label=a.primary_category_label||'善兆';
    const media=a.image_url
      ?`<div class="favorite-thumb"><img src="${esc(a.image_url)}" alt=""><span>${esc(label)}</span></div>`
      :`<div class="favorite-thumb visual-${code}" data-mark="${esc(label)}"><span>${esc(label)}</span></div>`;
    return`<article class="favorite-card" data-public-id="${esc(a.public_id)}">
      <a class="favorite-card-main" href="${articleUrl(a.public_id)}">${media}<div class="favorite-copy"><small>${esc(label)}</small><h2>${esc(a.title)}</h2><p>${esc(a.editorial_comment||a.summary||'')}</p></div></a>
      <button class="favorite-remove" type="button" data-remove="${esc(a.public_id)}">お気に入りから外す</button>
    </article>`;
  }

  async function renderFavorites(){
    const root=document.querySelector('#favorites-app');
    if(!root||!CFG)return;
    const ids=readFavorites();
    const count=document.querySelector('#favorites-count');
    if(count)count.textContent=String(ids.length);
    if(!ids.length){
      root.innerHTML='<div class="favorite-empty"><strong>まだお気に入りはありません。</strong><p>気になる善兆の記事で「♡ お気に入りに保存」を押すと、ここから読み返せます。</p><a href="index.html">善兆を探す →</a></div>';
      return;
    }

    root.innerHTML='<p class="muted">お気に入りを読み込み中です。</p>';
    try{
      const qs=new URLSearchParams({select:'*',brand_slug:`eq.${CFG.brandSlug}`,order:'published_at.desc.nullslast'});
      const res=await fetch(`${CFG.supabaseUrl}/rest/v1/nyu_public_articles?${qs}`,{headers:{apikey:CFG.publishableKey,Accept:'application/json'}});
      if(!res.ok)throw new Error(`API ${res.status}`);
      const articles=await res.json();
      const byId=new Map(articles.map(a=>[a.public_id,a]));
      const visible=ids.map(id=>byId.get(id)).filter(Boolean);
      const stale=ids.filter(id=>!byId.has(id));
      if(stale.length)writeFavorites(ids.filter(id=>byId.has(id)));
      if(count)count.textContent=String(visible.length);
      if(!visible.length){
        root.innerHTML='<div class="favorite-empty"><strong>保存した記事は現在公開されていません。</strong><p>公開中の善兆から、またお気に入りを選べます。</p><a href="index.html">善兆を探す →</a></div>';
        return;
      }
      root.innerHTML=visible.map(favoriteCard).join('');
      root.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click',()=>{
        const id=btn.dataset.remove;
        setFavorite(id,false);
        renderFavorites();
      }));
    }catch(err){
      root.innerHTML='<div class="favorite-empty"><strong>お気に入りを読み込めませんでした。</strong><p>通信状態を確認して、もう一度お試しください。</p></div>';
      console.error(err);
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    setupArticleFavorite();
    renderFavorites();
  });
})();
