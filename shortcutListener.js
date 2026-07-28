(function() {
  'use strict';

  if (window.__savageShortcutListener) return;
  window.__savageShortcutListener = true;

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return;
    if (event.code !== 'KeyA' && event.key?.toLowerCase() !== 'a') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    chrome.runtime.sendMessage({
      type: 'savage_toggle_shortcut'
    });
  }, true);
})();
