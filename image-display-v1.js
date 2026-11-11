(()=>{
  const labelToCode={善:'good',前:'forward',然:'nature',繕:'repair',禅:'mind',膳:'food'};
  const codeToLabel={good:'善',forward:'前',nature:'然',repair:'繕',mind:'禅',food:'膳'};
  const mediaSelector='.featured-media,.story-thumb,.related-thumb,.article-hero';

  function codeFromClassList(el,prefix){
    if(!el)return'';
    const cls=[...el.classList].find(c=>c.startsWith(prefix));
    return cls?cls.slice(prefix.length):'';
  }

  function resolveFallback(media){
    let code=codeFromClassList(media,'visual-');
    if(!code)code=codeFromClassList(media.closest('.featured-card'),'visual-');
    if(!code)code=codeFromClassList(document.querySelector('.article-category'),'cat-');
    const badge=media.querySelector('.story-badge,.related-badge')?.textContent?.trim();
    const articleLabel=document.querySelector('.article-category')?.textContent?.trim();
    const featuredLabel=media.closest('.featured-card')?.querySelector('.featured-tag')?.textContent?.trim();
    const label=badge||articleLabel||featuredLabel||codeToLabel[code]||'善兆';
    if(!code)code=labelToCode[label]||'forward';
    return{code,label};
  }

  function fallbackImage(img){
    if(!(img instanceof HTMLImageElement)||img.dataset.zennyuFallbackDone==='1')return;
    const media=img.closest(mediaSelector);
    if(!media)return;
    img.dataset.zennyuFallbackDone='1';
    const {code,label}=resolveFallback(media);
    media.classList.add(`visual-${code}`);
    media.dataset.mark=label;
    img.remove();
    if(media.classList.contains('article-hero')){
      const credit=media.nextElementSibling;
      if(credit?.classList.contains('article-image-attribution'))credit.remove();
    }
  }

  document.addEventListener('error',e=>{
    if(e.target instanceof HTMLImageElement)fallbackImage(e.target);
  },true);

  async function loadArticleRow(publicId){
    if(!publicId||!window.ZENNEWS_CONFIG)return null;
    const cfg=window.ZENNEWS_CONFIG;
    const qs=new URLSearchParams({select:'image_url,image_attribution',brand_slug:`eq.${cfg.brandSlug}`,public_id:`eq.${publicId}`,limit:'1'});
    try{
      const res=await fetch(`${cfg.supabaseUrl}/rest/v1/nyu_public_articles?${qs}`,{headers:{apikey:cfg.publishableKey,Accept:'application/json'}});
      if(!res.ok)return null;
      const rows=await res.json();
      return rows[0]||null;
    }catch{return null;}
  }

  function insertAttribution(hero,text){
    if(!hero||!text||!hero.querySelector('img'))return;
    let credit=hero.nextElementSibling;
    if(credit?.classList.contains('article-image-attribution')){
      credit.textContent=text;
      return;
    }
    credit=document.createElement('div');
    credit.className='article-image-attribution';
    credit.textContent=text;
    hero.insertAdjacentElement('afterend',credit);
  }

  function setupArticleAttribution(){
    const app=document.querySelector('#article-app');
    if(!app)return;
    const params=new URLSearchParams(location.search);
    const publicId=params.get('id')||params.get('public_id');
    if(!publicId)return;
    let done=false;
    const tryInject=async()=>{
      if(done)return;
      const hero=app.querySelector('.article-hero');
      if(!hero)return;
      done=true;
      const row=await loadArticleRow(publicId);
      if(row?.image_url&&row?.image_attribution)insertAttribution(hero,row.image_attribution);
    };
    const observer=new MutationObserver(()=>{void tryInject()});
    observer.observe(app,{childList:true,subtree:true});
    void tryInject();
    setTimeout(()=>observer.disconnect(),15000);
  }

  document.addEventListener('DOMContentLoaded',setupArticleAttribution);
})();
