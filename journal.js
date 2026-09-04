(async function () {
  const entriesEl = document.getElementById('entries');
  const emptyEl = document.getElementById('empty');
  let posts = [];
  try {
    const res = await fetch('posts.json', { cache: 'no-store' });
    if (res.ok) posts = await res.json();
  } catch (e) { console.warn('Impossible de charger posts.json', e); }

  if (!Array.isArray(posts) || posts.length === 0) { if (emptyEl) emptyEl.hidden = false; return; }

  posts = posts.slice().reverse();
  if (entriesEl) entriesEl.innerHTML = posts.map((n, i) => `
    <article class="entry-card" style="animation-delay:${Math.min(i * 0.06, 0.6)}s">
      <p class="entry-date mono">${escapeHtml(n.date || '')}</p>
      <h3>${escapeHtml(n.title || 'Sans titre')}</h3>
      <div class="entry-body">${escapeHtml(n.body || '')}</div>
    </article>
  `).join('');

  function escapeHtml(s) { return String(s).replace(/[&<>\"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
})();
