const GUESTBOOK_CONFIG_URL = 'site-config.json';
const GUESTBOOK_DATA_URL = 'guestbook.json';

function elByIds(...ids) {
  for (const id of ids) {
    if (!id) continue;
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '—';
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

async function loadGuestbookPage() {
  const entriesEl = elByIds('entries', 'gbList');
  const emptyEl = elByIds('empty', 'emptyGb');
  const form = elByIds('guestForm', 'gbForm');
  const statusEl = elByIds('gStatus', 'gbStatus');
  const submitBtn = elByIds('gSubmit', 'gbSubmit');
  const setupNotice = elByIds('gSetupNotice', 'gbDisabledHint');

  let cfg = { guestbook: {} };
  try { cfg = await fetchJson(GUESTBOOK_CONFIG_URL).catch(() => ({ guestbook: {} })); } catch (error) { console.warn('site-config.json introuvable', error); }
  const guestbookCfg = cfg.guestbook || {};
  const enabled = !!guestbookCfg.enabled && !!guestbookCfg.publicToken;

  if (!enabled) {
    if (setupNotice) setupNotice.hidden = false;
    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Le livre d\'or est actuellement désactivé.';
  }

  let entries = [];
  try { entries = await fetchJson(GUESTBOOK_DATA_URL).catch(() => []); } catch (error) { console.warn('Impossible de charger guestbook.json', error); }

  if (entriesEl) {
    const visibleEntries = Array.isArray(entries) ? entries.slice().reverse() : [];
    if (!visibleEntries.length) {
      if (emptyEl) emptyEl.hidden = false;
      entriesEl.innerHTML = '';
    } else {
      entriesEl.innerHTML = visibleEntries.map((entry) => `
        <article class="gb-card">
          <div class="gb-head"><span class="gb-name">${escapeHtml(entry.name || 'Anonyme')}</span><span class="gb-date mono">${escapeHtml(formatDate(entry.date))}</span></div>
          <p>${escapeHtml(entry.message || '')}</p>
        </article>
      `).join('');
    }
  }

  if (!form || !enabled) return;

  const honey = document.getElementById('gbHoney') || document.getElementById('gHoney') || null;
  const nameField = document.getElementById('gbName') || document.getElementById('gName');
  const messageField = document.getElementById('gbMessage') || document.getElementById('gMessage');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (honey && honey.value.trim()) return;

    const lastSubmit = Number(sessionStorage.getItem('guestbook-last-submit') || '0');
    if (Date.now() - lastSubmit < 180000) {
      if (statusEl) {
        statusEl.className = 'form-status err';
        statusEl.textContent = 'Merci d\'attendre 3 minutes avant un nouveau message.';
      }
      return;
    }

    const name = (nameField ? nameField.value : '').trim() || 'Anonyme';
    const message = (messageField ? messageField.value : '').trim();
    if (!message) {
      if (statusEl) {
        statusEl.className = 'form-status err';
        statusEl.textContent = 'Le message est vide.';
      }
      return;
    }

    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) {
      statusEl.className = 'form-status';
      statusEl.textContent = 'Envoi…';
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${guestbookCfg.owner}/${guestbookCfg.repo}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${guestbookCfg.publicToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({ title: `[Livre d'or] ${name}`, body: message, labels: ['guestbook-pending'] })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Le service a refusé l\'envoi.');
      }

      sessionStorage.setItem('guestbook-last-submit', String(Date.now()));
      form.reset();
      if (statusEl) {
        statusEl.className = 'form-status ok';
        statusEl.textContent = 'Message envoyé — il sera publié après relecture.';
      }
    } catch (error) {
      if (statusEl) {
        statusEl.className = 'form-status err';
        statusEl.textContent = error.message || 'Échec de l\'envoi.';
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', loadGuestbookPage);
