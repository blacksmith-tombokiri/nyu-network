(()=>{
  const root=document.querySelector('#site-header-root');
  if(!root)return;
  root.innerHTML=`
<header class="site-header">
  <div class="mobile-head wrap">
    <a class="brand-lockup" href="index.html" aria-label="ぜんにゅー ホーム">
      <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
      <span class="brand-copy"><small>GOOD SIGNS, EVERY DAY</small><strong data-brand-name>ぜんにゅー</strong></span>
    </a>
    <div class="header-actions">
      <button id="search-toggle" class="icon-btn" type="button" aria-label="検索を開く" aria-expanded="false"><span class="search-icon"></span></button>
      <button id="menu-toggle" class="icon-btn" type="button" aria-label="メニューを開く" aria-expanded="false"><span class="menu-icon"><i></i><i></i><i></i></span></button>
    </div>
  </div>
  <div id="search-panel" class="search-panel" hidden>
    <div class="wrap search-panel-inner"><input id="search" type="search" placeholder="善兆を検索" autocomplete="off"><button id="search-close" type="button">閉じる</button></div>
  </div>
</header>
<div id="drawer-backdrop" class="drawer-backdrop" hidden></div>
<aside id="side-drawer" class="side-drawer" aria-hidden="true">
  <div class="drawer-head">
    <div class="brand-lockup compact"><span class="brand-mark"><i></i><i></i><i></i></span><span class="brand-copy"><small>GOOD SIGNS, EVERY DAY</small><strong data-brand-name>ぜんにゅー</strong></span></div>
    <button id="drawer-close" class="drawer-close" type="button" aria-label="メニューを閉じる">×</button>
  </div>
  <nav class="drawer-nav">
    <a href="index.html">ホーム</a>
    <a href="#drawer-ranking">よく読まれている善兆</a>
    <a href="about.html">ぜんにゅーについて</a>
  </nav>
  <section id="drawer-ranking" class="drawer-section"><h2>よく読まれている善兆</h2><div id="drawer-ranking-list" class="drawer-ranking-list"><p class="muted">集計準備中です。</p></div></section>
  <section class="drawer-section"><h2>カテゴリから探す</h2><div id="drawer-categories" class="drawer-categories"></div></section>
  <div class="drawer-footer"><span>設定</span><small>準備中</small></div>
</aside>`;
})();
