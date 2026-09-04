const CONFIG_PATH = 'site-config.json';
const PHOTOS_PATH = 'photos.json';
const POSTS_PATH = 'posts.json';
const GUESTBOOK_PATH = 'guestbook.json';

const state = {
  config: { contactEmail: '', guestbook: { enabled: false, owner: '', repo: '', branch: 'main', publicToken: '' } },
  photos: [],
  posts: [],
  guestbook: []
};

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
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

function setStatus(elId, message, isOk = false, isError = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.className = 'form-status';
  if (isOk) el.classList.add('ok');
  if (isError) el.classList.add('err');
  el.textContent = message;
}

function setContactHint() {
  const hint = document.getElementById('cDisabledHint');
  const submit = document.getElementById('cSubmit');
  if (!submit) return;

  if (!(state.config && state.config.contactEmail)) {
    if (hint) hint.hidden = false;
    submit.disabled = true;
    return;
  }

  if (hint) hint.hidden = true;
  submit.disabled = false;
}

function setGuestbookHint() {
  const button = document.getElementById('gbSubmit');
  const hint = document.getElementById('gbDisabledHint');
  const status = document.getElementById('gbStatus');
  if (!button) return;

  const enabled = !!(state.config.guestbook && state.config.guestbook.enabled && state.config.guestbook.publicToken);
  if (!enabled) {
    if (hint) hint.hidden = false;
    button.disabled = true;
    if (status) setStatus('gbStatus', 'Le livre d\'or est actuellement désactivé.', false, false);
    return;
  }

  if (hint) hint.hidden = true;
  button.disabled = false;
}

function renderGallery() {
  const tabs = document.getElementById('folderTabs');
  const sheet = document.getElementById('sheet');
  const empty = document.getElementById('emptyPhotos');
  if (!tabs || !sheet || !empty) return;

  const photos = Array.isArray(state.photos) ? state.photos : [];
  if (!photos.length) {
    tabs.hidden = true;
    sheet.hidden = true;
    empty.hidden = false;
    return;
  }

  const folders = [...new Set(photos.map((p) => p.folder || 'Général'))];
  const activeFolder = tabs.dataset.activeFolder && folders.includes(tabs.dataset.activeFolder)
    ? tabs.dataset.activeFolder
    : folders[0];

  tabs.innerHTML = folders.map((folder) => {
    const count = photos.filter((p) => (p.folder || 'Général') === folder).length;
    return `<button class="folder-tab ${folder === activeFolder ? 'active' : ''}" data-folder="${escapeHtml(folder)}"><span>${escapeHtml(folder)}</span><span class="count">${count}</span></button>`;
  }).join('');
  tabs.dataset.activeFolder = activeFolder;
  tabs.hidden = false;

  const items = photos.filter((p) => (p.folder || 'Général') === activeFolder);
  if (!items.length) {
    sheet.hidden = true;
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  sheet.hidden = false;
  sheet.innerHTML = items.map((photo, index) => `
    <article class="frame" data-index="${index}" tabindex="0">
      <div class="sprockets"><span></span><span></span><span></span></div>
      <div class="shot"><img src="photos/${encodeURI(photo.file)}" alt="${escapeHtml(photo.caption || 'Photo')}" loading="lazy"></div>
      <div class="meta"><span class="cap">${escapeHtml(photo.caption || photo.file)}</span><span class="num mono">${String(index + 1).padStart(2, '0')}</span></div>
    </article>
  `).join('');

  tabs.querySelectorAll('.folder-tab').forEach((button) => {
    button.addEventListener('click', () => {
      tabs.dataset.activeFolder = button.dataset.folder;
      renderGallery();
    });
  });

  sheet.querySelectorAll('.frame').forEach((frame) => {
    const open = () => openProjector(activeFolder, Number(frame.dataset.index));
    frame.addEventListener('click', open);
    frame.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function openProjector(folder, index) {
  const projector = document.getElementById('projector');
  const img = document.getElementById('projImg');
  const cap = document.getElementById('projCap');
  const num = document.getElementById('projNum');
  if (!projector || !img || !cap || !num) return;

  const items = state.photos.filter((p) => (p.folder || 'Général') === folder);
  if (!items.length) return;

  let currentIndex = Math.max(0, Math.min(index, items.length - 1));
  const renderCurrent = () => {
    const item = items[currentIndex];
    img.src = `photos/${encodeURI(item.file)}`;
    img.alt = item.caption || 'Photo';
    cap.textContent = item.caption || item.file;
    num.textContent = `${String(currentIndex + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
  };

  renderCurrent();
  projector.classList.add('open');

  const close = document.getElementById('close');
  const prev = document.getElementById('prev');
  const next = document.getElementById('next');

  if (close) close.onclick = () => projector.classList.remove('open');
  if (prev) prev.onclick = () => { currentIndex = (currentIndex - 1 + items.length) % items.length; renderCurrent(); };
  if (next) next.onclick = () => { currentIndex = (currentIndex + 1) % items.length; renderCurrent(); };

  document.addEventListener('keydown', (event) => {
    if (!projector.classList.contains('open')) return;
    if (event.key === 'Escape') projector.classList.remove('open');
    if (event.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % items.length; renderCurrent(); }
    if (event.key === 'ArrowLeft') { currentIndex = (currentIndex - 1 + items.length) % items.length; renderCurrent(); }
  }, { once: true });
}

function renderJournal() {
  const list = document.getElementById('journalList');
  const empty = document.getElementById('emptyJournal');
  if (!list || !empty) return;

  const posts = (state.posts || []).slice().reverse();
  if (!posts.length) {
    list.hidden = true;
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  list.hidden = false;
  list.innerHTML = posts.map((post, index) => `
    <article class="journal-entry" style="animation-delay:${Math.min(index * 0.05, 0.5)}s">
      <div class="je-date mono">${escapeHtml(formatDate(post.date))}</div>
      <h3>${escapeHtml(post.title || 'Sans titre')}</h3>
      <p>${escapeHtml(post.body || '')}</p>
    </article>
  `).join('');
}

function renderGuestbook() {
  const list = document.getElementById('gbList');
  const empty = document.getElementById('emptyGb');
  if (!list) return;

  const entries = (state.guestbook || []).slice().reverse();
  if (!entries.length) {
    if (empty) empty.hidden = false;
    list.innerHTML = '';
    return;
  }

  if (empty) empty.hidden = true;
  list.innerHTML = entries.map((entry) => `
    <article class="gb-card">
      <div class="gb-head"><span class="gb-name">${escapeHtml(entry.name || 'Anonyme')}</span><span class="gb-date mono">${escapeHtml(formatDate(entry.date))}</span></div>
      <p>${escapeHtml(entry.message || '')}</p>
    </article>
  `).join('');
}

function updateFooterStats() {
  const footerStats = document.getElementById('footerStats');
  if (!footerStats) return;
  footerStats.textContent = `Photos ${state.photos.length} · Notes ${state.posts.length} · Messages ${state.guestbook.length} · hébergé sur GitHub Pages`;
}

async function loadPublicData() {
  try {
    const config = await fetchJson(CONFIG_PATH).catch(() => ({ contactEmail: '', guestbook: {} }));
    state.config = config || { contactEmail: '', guestbook: {} };

    const [photos, posts, guestbook] = await Promise.all([
      fetchJson(PHOTOS_PATH).catch(() => []),
      fetchJson(POSTS_PATH).catch(() => []),
      fetchJson(GUESTBOOK_PATH).catch(() => [])
    ]);

    state.photos = Array.isArray(photos) ? photos : [];
    state.posts = Array.isArray(posts) ? posts : [];
    state.guestbook = Array.isArray(guestbook) ? guestbook : [];

    setContactHint();
    setGuestbookHint();
    renderGallery();
    renderJournal();
    renderGuestbook();
    updateFooterStats();
  } catch (error) {
    console.warn('Impossible de charger les données publiques', error);
    const emptyPhotos = document.getElementById('emptyPhotos');
    if (emptyPhotos) emptyPhotos.hidden = false;
    const emptyJournal = document.getElementById('emptyJournal');
    if (emptyJournal) emptyJournal.hidden = false;
  }
}

function bindContactForm() {
  const form = document.getElementById('contactForm');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = (state.config && state.config.contactEmail) || '';
    if (!email) {
      setStatus('cStatus', 'Aucune adresse de contact n\'est configurée.', false, true);
      return;
    }

    const name = document.getElementById('cName')?.value?.trim() || '';
    const subject = document.getElementById('cSubject')?.value?.trim() || 'Message via le site';
    const message = document.getElementById('cMessage')?.value?.trim() || '';
    window.location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Nom : ${name}\n\nMessage :\n${message}`)}`;
    setStatus('cStatus', 'Votre messagerie a été ouverte.', true, false);
    form.reset();
  });
}

function bindGuestbookForm() {
  const form = document.getElementById('gbForm');
  if (!form) return;

  const count = document.getElementById('gbCount');
  const textarea = document.getElementById('gbMessage');
  if (count && textarea) {
    const update = () => { count.textContent = String(textarea.value.length || 0); };
    textarea.addEventListener('input', update);
    update();
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const cfg = state.config && state.config.guestbook ? state.config.guestbook : {};
    const enabled = !!cfg.enabled && !!cfg.publicToken;
    if (!enabled) {
      setStatus('gbStatus', 'Le livre d\'or n\'est pas activé pour ce site.', false, true);
      return;
    }

    const honey = document.getElementById('gbHoney');
    if (honey && honey.value.trim()) {
      setStatus('gbStatus', 'Soumission bloquée.', false, true);
      return;
    }

    const lastSubmit = Number(sessionStorage.getItem('guestbook-last-submit') || '0');
    if (Date.now() - lastSubmit < 180000) {
      setStatus('gbStatus', 'Merci d\'attendre 3 minutes avant un nouveau message.', false, true);
      return;
    }

    const name = document.getElementById('gbName')?.value?.trim() || 'Anonyme';
    const message = document.getElementById('gbMessage')?.value?.trim() || '';
    if (!message) {
      setStatus('gbStatus', 'Le message est vide.', false, true);
      return;
    }

    const submitBtn = document.getElementById('gbSubmit');
    if (submitBtn) submitBtn.disabled = true;
    setStatus('gbStatus', 'Envoi…', false, false);

    try {
      const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfg.publicToken}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          title: `[Livre d'or] ${name}`,
          body: message,
          labels: ['guestbook-pending']
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Impossible d\'envoyer le message.');
      }

      sessionStorage.setItem('guestbook-last-submit', String(Date.now()));
      form.reset();
      if (count) count.textContent = '0';
      setStatus('gbStatus', 'Message envoyé — il sera publié après relecture.', true, false);
    } catch (error) {
      setStatus('gbStatus', error.message || 'Échec de l\'envoi.', false, true);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      setGuestbookHint();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindContactForm();
  bindGuestbookForm();
  loadPublicData();
});
