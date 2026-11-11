/* Article sharing for ぜんにゅー. Public data only, no SDK required. */
(() => {
  'use strict';
  const SITE_ORIGIN = 'https://zen.nyu-net.jp';
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;
  const URL_BASE = SITE_ORIGIN + '/story/';

  function articleContext(button) {
    const container = button.closest('.article-share');
    const id = container?.dataset.publicId || '';
    if (!ID_PATTERN.test(id)) return null;
    const title = document.querySelector('.article-title')?.textContent?.trim() || 'ぜんにゅーの記事';
    return { container, title, url: URL_BASE + encodeURIComponent(id) + '/' };
  }

  function feedback(container, message) {
    const status = container?.querySelector('.article-share-status');
    if (status) status.textContent = message;
  }

  async function copyUrl(url) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(url); return true; } catch (_) {}
    }
    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    let success = false;
    try { success = document.execCommand('copy'); } catch (_) {}
    textarea.remove();
    return success;
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-share-action]');
    if (!button) return;
    const context = articleContext(button);
    if (!context) return;
    const { container, title, url } = context;
    const action = button.dataset.shareAction;
    feedback(container, '');

    if (action === 'x') {
      const target = 'https://twitter.com/intent/tweet?text=' +
        encodeURIComponent(title + '｜ぜんにゅー') + '&url=' + encodeURIComponent(url);
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'line') {
      const target = 'https://social-plugins.line.me/lineit/share?url=' +
        encodeURIComponent(url) + '&text=' + encodeURIComponent(title);
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    if (action === 'native' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: title + '｜ぜんにゅー', url });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    if (action === 'copy' || action === 'native') {
      if (await copyUrl(url)) {
        feedback(container, '記事のURLをコピーしました。');
      } else {
        feedback(container, 'URLをコピーできませんでした。表示されたURLを手動でコピーしてください。');
        window.prompt('この記事のURL', url);
      }
    }
  });
})();
