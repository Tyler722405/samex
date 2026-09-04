const FILES_URL = 'files.json';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function getFileExtension(name = '') {
  return (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
}

function isImageFile(name) {
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(getFileExtension(name));
}

function isPdfFile(name) {
  return getFileExtension(name) === 'pdf';
}

function isTextFile(name) {
  const ext = getFileExtension(name);
  return ['txt', 'md', 'csv', 'json', 'xml', 'html', 'svg'].includes(ext);
}

function getFilePath(file) {
  return file ? `files/${String(file).split('/').map(encodeURIComponent).join('/')}` : '#';
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

function closePreview() {
  const modal = document.getElementById('filePreviewModal');
  if (!modal) return;
  modal.hidden = true;
  const content = document.getElementById('filePreviewContent');
  if (content) content.innerHTML = '';
}

async function openPreview(item) {
  const modal = document.getElementById('filePreviewModal');
  const content = document.getElementById('filePreviewContent');
  if (!modal || !content) return;

  const path = getFilePath(item.file);
  const fileName = item.name || item.file || 'Fichier';
  const ext = getFileExtension(item.file || fileName);

  content.innerHTML = '<p class="hint">Chargement…</p>';
  modal.hidden = false;

  try {
    if (isImageFile(item.file || fileName)) {
      content.innerHTML = `
        <div class="file-preview-header">
          <h3>${escapeHtml(fileName)}</h3>
          <a class="ghost" href="${escapeHtml(path)}" target="_blank" rel="noopener noreferrer">Télécharger</a>
        </div>
        <img class="file-preview-image" src="${escapeHtml(path)}" alt="${escapeHtml(fileName)}">
      `;
      return;
    }

    if (isPdfFile(item.file || fileName)) {
      content.innerHTML = `
        <div class="file-preview-header">
          <h3>${escapeHtml(fileName)}</h3>
          <a class="ghost" href="${escapeHtml(path)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>
        </div>
        <iframe class="file-preview-iframe" src="${escapeHtml(path)}" title="${escapeHtml(fileName)}"></iframe>
      `;
      return;
    }

    if (isTextFile(item.file || fileName)) {
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error('Impossible de lire le fichier');
      const text = await res.text();
      content.innerHTML = `
        <div class="file-preview-header">
          <h3>${escapeHtml(fileName)}</h3>
          <a class="ghost" href="${escapeHtml(path)}" target="_blank" rel="noopener noreferrer">Télécharger</a>
        </div>
        <pre class="file-preview-text">${escapeHtml(text.slice(0, 6000))}</pre>
      `;
      return;
    }

    content.innerHTML = `
      <div class="file-preview-header">
        <h3>${escapeHtml(fileName)}</h3>
        <a class="ghost" href="${escapeHtml(path)}" target="_blank" rel="noopener noreferrer">Télécharger</a>
      </div>
      <p class="hint">Aperçu non disponible pour ce type de fichier (${escapeHtml(ext || 'inconnu')}).</p>
    `;
  } catch (error) {
    console.warn('Aperçu impossible', error);
    content.innerHTML = `
      <div class="file-preview-header">
        <h3>${escapeHtml(fileName)}</h3>
        <a class="ghost" href="${escapeHtml(path)}" target="_blank" rel="noopener noreferrer">Télécharger</a>
      </div>
      <p class="hint err">Aperçu indisponible pour ce fichier.</p>
    `;
  }
}

async function loadFilesPage() {
  const list = document.getElementById('filesList');
  const empty = document.getElementById('emptyFiles');
  const modal = document.getElementById('filePreviewModal');
  if (!list) return;

  if (modal) {
    const closeBtn = modal.querySelector('.file-preview-close');
    const backdrop = modal.querySelector('.file-preview-backdrop');
    if (closeBtn) closeBtn.addEventListener('click', closePreview);
    if (backdrop) backdrop.addEventListener('click', closePreview);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.hidden) closePreview();
    });
  }

  try {
    const files = await fetchJson(FILES_URL).catch(() => []);
    const entries = Array.isArray(files) ? files : [];
    if (!entries.length) {
      if (empty) empty.hidden = false;
      list.innerHTML = '';
      return;
    }

    if (empty) empty.hidden = true;
    const groups = entries.reduce((acc, entry) => {
      const folder = entry.folder || 'Général';
      acc[folder] = acc[folder] || [];
      acc[folder].push(entry);
      return acc;
    }, {});

    list.innerHTML = Object.entries(groups).map(([folder, items]) => `
      <div class="lib-folder">
        <h4>${escapeHtml(folder)} · ${items.length}</h4>
        ${items.map((item) => {
          const ext = (item.file || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toUpperCase() || 'FILE';
          const href = getFilePath(item.file);
          return `
            <div class="lib-row">
              <span class="file-icon">${escapeHtml(ext)}</span>
              <span class="name">${escapeHtml(item.name || item.file || 'Fichier')}</span>
              <button type="button" class="ghost preview-trigger" data-file="${escapeHtml(item.file || '')}" data-name="${escapeHtml(item.name || item.file || 'Fichier')}">Aperçu</button>
              <a class="ghost" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>
            </div>
          `;
        }).join('')}
      </div>
    `).join('');

    list.querySelectorAll('.preview-trigger').forEach((button) => {
      button.addEventListener('click', () => {
        const file = button.dataset.file;
        const name = button.dataset.name;
        const item = entries.find((entry) => (entry.file || '').endsWith(file) || (entry.name || entry.file) === name) || { file, name };
        openPreview(item);
      });
    });
  } catch (error) {
    console.warn('Impossible de charger files.json', error);
    if (empty) empty.hidden = false;
    list.innerHTML = '<p class="hint">Aucun fichier disponible pour l\'instant.</p>';
  }
}

document.addEventListener('DOMContentLoaded', loadFilesPage);
