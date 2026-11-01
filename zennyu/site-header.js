(()=>{
  if(!document.querySelector('link[data-zennyu-design]')){
    const design=document.createElement('link');
    design.rel='stylesheet';
    design.href='design-v1.css?v=20261101-1';
    design.dataset.zennyuDesign='1';
    document.head.appendChild(design);
  }
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
  <nav class="drawer-nav" aria-label="サイトメニュー">
    <a href="about.html">ぜんにゅーについて</a>
    <a href="popular.html">よく読まれている善兆</a>
    <a href="reaction-history.html">リアクション履歴を管理</a>
    <a href="policy.html">運営方針</a>
    <a href="contact.html">お問い合わせ</a>
    <a href="privacy.html">プライバシーポリシー</a>
  </nav>
</aside>`;
  if(!document.querySelector('#home-app')){
    const search=root.querySelector('#search');
    search?.addEventListener('keydown',e=>{
      if(e.key!=='Enter')return;
      const q=search.value.trim();
      if(q)location.href=`index.html?q=${encodeURIComponent(q)}`;
    });
  }
})();
