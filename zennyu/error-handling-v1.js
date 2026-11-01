(()=>{
  const esc=(v='')=>String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  function stateHtml({title,message,compact=false,retry=false,home=true,mark='ぜんにゅー'}){
    return `<div class="${compact?'':'system-state-shell'}"><section class="system-state${compact?' system-state--compact':''}" role="status" aria-live="polite"><span class="system-state-mark">${esc(mark)}</span><h${compact?'2':'1'}>${esc(title)}</h${compact?'2':'1'}><p>${esc(message)}</p><div class="system-state-actions">${retry?'<button class="system-state-action" type="button" data-error-retry>もう一度読み込む</button>':''}${home?'<a class="system-state-action secondary" href="index.html">ぜんにゅーのホームへ</a>':''}</div></section></div>`;
  }

  function markRendered(root){root.dataset.errorRendered='1'}
  function alreadyRendered(root){return root.dataset.errorRendered==='1'}

  function replaceArticleState(root){
    if(alreadyRendered(root))return;
    const text=(root.textContent||'').trim();
    if(!text)return;
    if(text.includes('記事が指定されていません')){
      markRendered(root);
      document.title='記事が指定されていません｜ぜんにゅー';
      root.innerHTML=stateHtml({title:'記事が指定されていません',message:'URLから記事を特定できませんでした。ホームから読みたい善兆を探してみてください。'});
      return;
    }
    if(text.includes('記事が見つかりません')){
      markRendered(root);
      document.title='記事が見つかりません｜ぜんにゅー';
      root.innerHTML=stateHtml({title:'この記事は見つかりませんでした',message:'URLが変更されたか、記事が公開されていない可能性があります。ホームから別の善兆を探してみてください。'});
      return;
    }
    if(text.includes('記事を読み込めませんでした')){
      markRendered(root);
      document.title='記事を読み込めません｜ぜんにゅー';
      root.innerHTML=stateHtml({title:'記事を読み込めませんでした',message:'通信が一時的に不安定な可能性があります。少ししてから、もう一度お試しください。',retry:true});
    }
  }

  function replaceHomeState(root){
    if(alreadyRendered(root))return;
    const text=(root.textContent||'').trim();
    if(!text.includes('実データを読み込めませんでした'))return;
    markRendered(root);
    root.innerHTML=stateHtml({title:'善兆を読み込めませんでした',message:'通信が一時的に不安定な可能性があります。時間をおいて再度お試しください。',retry:true});
  }

  function replacePopularState(root){
    if(alreadyRendered(root))return;
    const text=(root.textContent||'').trim();
    if(!text.includes('ランキングを読み込めませんでした'))return;
    markRendered(root);
    root.innerHTML=stateHtml({title:'ランキングを読み込めませんでした',message:'通信が一時的に不安定な可能性があります。少ししてから、もう一度お試しください。',compact:true,retry:true,home:false});
  }

  function observe(selector,handler){
    const root=document.querySelector(selector);
    if(!root)return;
    const run=()=>handler(root);
    run();
    new MutationObserver(run).observe(root,{childList:true,subtree:true,characterData:true});
  }

  document.addEventListener('click',e=>{
    const retry=e.target.closest('[data-error-retry]');
    if(retry)location.reload();
  });

  document.addEventListener('DOMContentLoaded',()=>{
    observe('#article-app',replaceArticleState);
    observe('#home-app',replaceHomeState);
    observe('#popular-list',replacePopularState);
  });
})();
