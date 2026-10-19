// Vor dem Stylesheet ausführen, damit beim Laden kein heller Hintergrund aufblitzt.
(() => {
  const key = 'creeunity:theme';
  let theme = 'dark';
  try { const saved = localStorage.getItem(key); if (['light', 'dark'].includes(saved)) theme = saved; } catch {}
  function apply(value) {
    document.documentElement.dataset.theme = value;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value === 'dark' ? '#142b23' : '#f8f8f0');
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.textContent = value === 'dark' ? '☀' : '☾';
      button.setAttribute('aria-label', value === 'dark' ? 'Hellmodus aktivieren' : 'Dunkelmodus aktivieren');
      button.setAttribute('aria-pressed', String(value === 'dark'));
      button.title = value === 'dark' ? 'Hellmodus' : 'Dunkelmodus';
    }
  }
  apply(theme);
  document.addEventListener('DOMContentLoaded', () => {
    apply(theme);
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(key, theme); } catch {}
      apply(theme);
    });
  });
  window.addEventListener('storage', event => {
    if (event.key === key) { theme = event.newValue === 'light' ? 'light' : 'dark'; apply(theme); }
  });
})();
