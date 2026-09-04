// Espace propriétaire — coffre chiffré + gestion complète du site.
//
// SÉCURITÉ — rappel des couches en place :
// 1. AES-256-GCM (clé dérivée par PBKDF2, 250 000 itérations) pour le coffre
//    d'identifiants GitHub privés (Contents: read/write, Issues: read/write).
// 2. Délai croissant après chaque mot de passe erroné.
// 3. Verrouillage automatique après 15 minutes d'inactivité.
// 4. Vérification du jeton auprès de l'API GitHub après déverrouillage.
// 5. CSP stricte sur les deux pages.
// 6. Le "jeton public du livre d'or" (section Configuration) est un jeton
//    SÉPARÉ, volontairement limité à "Issues: write", stocké EN CLAIR dans
//    site-config.json pour que les visiteurs puissent l'utiliser sans compte.
//    C'est un compromis assumé — voir le README.

const VAULT_KEY = 'gallery_vault_v2';
const SESSION_KEY = 'gallery_session_cfg';
const LOCKOUT_KEY = 'gallery_lockout_v1';
const PBKDF2_ITER = 250000;
const IDLE_LIMIT_MS = 15 * 60 * 1000;

/* ---------------- Utilitaires crypto ---------------- */

function bufToB64(buf) { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
function b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

async function deriveKey(password, saltB64) {
  const salt = b64ToBuf(saltB64);
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptVault(password, configObj) {
  const saltB64 = bufToB64(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, saltB64);
  const plain = new TextEncoder().encode(JSON.stringify(configObj));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  return { salt: saltB64, iv: bufToB64(iv), cipher: bufToB64(cipherBuf) };
}
async function decryptVault(password, vault) {
  const key = await deriveKey(password, vault.salt);
  const iv = b64ToBuf(vault.iv);
  const cipher = b64ToBuf(vault.cipher);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plainBuf));
}

function log(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString('fr-FR')} — ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

if (!window.isSecureContext) {
  document.getElementById('lockoutBanner').hidden = false;
  document.getElementById('lockoutBanner').textContent = 'Cette page n\'est pas servie en HTTPS : le chiffrement du coffre n\'est pas disponible ici.';
}

/* ---------------- Verrouillage anti-brute-force ---------------- */

function getLockout() { try { return JSON.parse(localStorage.getItem(LOCKOUT_KEY) || 'null') || { fails: 0, until: 0 }; } catch (e) { return { fails: 0, until: 0 }; } }
function setLockout(o) { localStorage.setItem(LOCKOUT_KEY, JSON.stringify(o)); }
function clearLockout() { localStorage.removeItem(LOCKOUT_KEY); }
function registerFailure() {
  const o = getLockout();
  o.fails += 1;
  o.until = Date.now() + Math.min(Math.pow(2, o.fails), 60) * 1000;
  setLockout(o);
  return o;
}
function lockoutRemainingMs() { return Math.max(0, getLockout().until - Date.now()); }

let lockoutTimer = null;
function renderLockoutBanner() {
  const banner = document.getElementById('lockoutBanner');
  const remaining = lockoutRemainingMs();
  const unlockBtn = document.getElementById('unlockBtn');
  clearInterval(lockoutTimer);
  if (remaining <= 0) { banner.hidden = true; if (unlockBtn) unlockBtn.disabled = false; return; }
  if (unlockBtn) unlockBtn.disabled = true;
  banner.hidden = false;
  const tick = () => {
    const ms = lockoutRemainingMs();
    if (ms <= 0) { renderLockoutBanner(); return; }
    banner.textContent = `Trop de tentatives — réessaie dans ${Math.ceil(ms / 1000)}s.`;
  };
  tick();
  lockoutTimer = setInterval(tick, 500);
}

/* ---------------- État des sections ---------------- */

const gateSet = document.getElementById('gateSet');
const gateUnlock = document.getElementById('gateUnlock');
const consoleSection = document.getElementById('console');
let cfg = null;

function showGate() {
  const stored = localStorage.getItem(VAULT_KEY);
  gateSet.hidden = !!stored;
  gateUnlock.hidden = !stored;
  consoleSection.hidden = true;
  if (!stored) document.getElementById('lockoutBanner').hidden = true;
  else renderLockoutBanner();
}
function fillCredFields() {
  document.getElementById('owner').value = cfg.owner || '';
  document.getElementById('repo').value = cfg.repo || '';
  document.getElementById('branch').value = cfg.branch || 'main';
  document.getElementById('token').value = cfg.token || '';
}
async function unlockConsole() {
  gateSet.hidden = true; gateUnlock.hidden = true; consoleSection.hidden = false;
  document.getElementById('lockoutBanner').hidden = true;
  fillCredFields();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(cfg));
  resetIdleTimer();
  await checkTokenScope();
  await loadFolderOptions();
  await loadFileFolderOptions();
  await loadPosts();
  await loadFilesLibrary();
  await loadConfig();
}
(function tryResumeSession() {
  const s = sessionStorage.getItem(SESSION_KEY);
  if (s) { try { cfg = JSON.parse(s); unlockConsole(); return; } catch (e) {} }
  showGate();
})();

/* ---------------- Auto-verrouillage sur inactivité ---------------- */

let idleTimer = null;
function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (consoleSection.hidden) return;
  idleTimer = setTimeout(() => { doLock(); showIdleToast(); }, IDLE_LIMIT_MS);
}
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt =>
  document.addEventListener(evt, () => { if (!consoleSection.hidden) resetIdleTimer(); }, { passive: true })
);
function showIdleToast() {
  const t = document.createElement('div');
  t.className = 'idle-toast mono';
  t.textContent = 'Verrouillé après inactivité.';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}
function doLock() {
  sessionStorage.removeItem(SESSION_KEY);
  cfg = null;
  document.getElementById('unlockPass').value = '';
  clearTimeout(idleTimer);
  showGate();
}

/* ---------------- Force du mot de passe ---------------- */

function passwordScore(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1;
  return Math.min(score, 6);
}
const p1El = document.getElementById('vaultPass1');
p1El.addEventListener('input', () => {
  const score = passwordScore(p1El.value);
  document.getElementById('strengthBar').style.width = (score / 6) * 100 + '%';
  const labels = ['très faible', 'faible', 'correct', 'correct', 'bon', 'solide', 'excellent'];
  document.getElementById('strengthLabel').textContent = p1El.value ? `Robustesse estimée : ${labels[score]}.` : 'Au moins 8 caractères ; visez 12+ avec des mots peu communs.';
});

/* ---------------- Création / déverrouillage du coffre ---------------- */

document.getElementById('createVaultBtn').addEventListener('click', async () => {
  const errEl = document.getElementById('vaultSetErr');
  errEl.textContent = '';
  const owner = document.getElementById('vaultOwner').value.trim();
  const repo = document.getElementById('vaultRepo').value.trim();
  const branch = document.getElementById('vaultBranch').value.trim() || 'main';
  const token = document.getElementById('vaultToken').value.trim();
  const p1 = document.getElementById('vaultPass1').value;
  const p2 = document.getElementById('vaultPass2').value;
  if (!owner || !repo || !token) { errEl.textContent = 'Compte, dépôt et jeton sont requis.'; return; }
  if (p1.length < 8) { errEl.textContent = 'Le mot de passe doit faire au moins 8 caractères.'; return; }
  if (p1 !== p2) { errEl.textContent = 'Les deux mots de passe ne correspondent pas.'; return; }
  const vault = await encryptVault(p1, { owner, repo, branch, token });
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  clearLockout();
  cfg = { owner, repo, branch, token };
  unlockConsole();
});

document.getElementById('unlockBtn').addEventListener('click', attemptUnlock);
document.getElementById('unlockPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptUnlock(); });
async function attemptUnlock() {
  if (lockoutRemainingMs() > 0) { renderLockoutBanner(); return; }
  const errEl = document.getElementById('unlockErr');
  errEl.textContent = '';
  const password = document.getElementById('unlockPass').value;
  const vault = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
  if (!vault) { showGate(); return; }
  try {
    cfg = await decryptVault(password, vault);
    clearLockout();
    unlockConsole();
  } catch (e) {
    const o = registerFailure();
    errEl.textContent = `Mot de passe incorrect (${o.fails} tentative${o.fails > 1 ? 's' : ''}).`;
    renderLockoutBanner();
  }
}
document.getElementById('resetVaultBtn').addEventListener('click', () => {
  if (confirm('Ceci supprime le coffre chiffré de ce navigateur. Continuer ?')) {
    localStorage.removeItem(VAULT_KEY);
    sessionStorage.removeItem(SESSION_KEY);
    clearLockout();
    cfg = null;
    showGate();
  }
});
document.getElementById('lockBtn').addEventListener('click', doLock);

document.getElementById('saveCredsBtn').addEventListener('click', async () => {
  const owner = document.getElementById('owner').value.trim();
  const repo = document.getElementById('repo').value.trim();
  const branch = document.getElementById('branch').value.trim() || 'main';
  const token = document.getElementById('token').value.trim();
  if (!owner || !repo || !token) { alert('Compte, dépôt et jeton sont requis.'); return; }
  const password = prompt('Confirmez le mot de passe du coffre pour rechiffrer :');
  if (!password) return;
  const vault = JSON.parse(localStorage.getItem(VAULT_KEY) || 'null');
  try { if (vault) await decryptVault(password, vault); } catch (e) { alert('Mot de passe incorrect — identifiants non modifiés.'); return; }
  cfg = { owner, repo, branch, token };
  const newVault = await encryptVault(password, cfg);
  localStorage.setItem(VAULT_KEY, JSON.stringify(newVault));
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(cfg));
  log('log', 'Identifiants mis à jour et rechiffrés.');
  await checkTokenScope();
  await loadFolderOptions();
});

async function checkTokenScope() {
  const badge = document.getElementById('tokenScopeBadge');
  badge.hidden = false; badge.className = 'badge mono'; badge.textContent = 'Vérification du jeton…';
  try {
    const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, { headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' } });
    if (res.status === 401 || res.status === 403) { badge.classList.add('badge--warn'); badge.textContent = 'Jeton invalide ou expiré'; return; }
    if (res.status === 404) { badge.classList.add('badge--warn'); badge.textContent = 'Dépôt introuvable'; return; }
    if (!res.ok) { badge.classList.add('badge--warn'); badge.textContent = `Erreur API (${res.status})`; return; }
    const data = await res.json();
    if (data.permissions && data.permissions.push) { badge.classList.add('badge--live'); badge.textContent = `✓ Écriture confirmée sur ${cfg.owner}/${cfg.repo}`; }
    else { badge.classList.add('badge--warn'); badge.textContent = 'Jeton en lecture seule'; }
  } catch (e) { badge.classList.add('badge--warn'); badge.textContent = 'Vérification impossible'; }
}

/* ---------------- Onglets ---------------- */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
    if (btn.dataset.tab === 'moderation') loadModeration();
  });
});

/* ---------------- Helpers génériques GitHub Contents ---------------- */

function slugify(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dossier';
}
async function ghContents(path, options = {}) {
  return fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', ...(options.headers || {}) },
  });
}
async function fetchJsonFile(path) {
  const res = await ghContents(`${path}?ref=${cfg.branch}&t=${Date.now()}`);
  if (res.ok) {
    const data = await res.json();
    const content = JSON.parse(decodeURIComponent(escape(atob(data.content.replace(/\n/g, '')))));
    return { content, sha: data.sha };
  }
  if (res.status === 404) return { content: null, sha: null };
  const err = await res.json().catch(() => ({}));
  throw new Error(err.message || `HTTP ${res.status}`);
}
async function writeJsonFile(path, data, sha, message) {
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const res = await ghContents(path, { method: 'PUT', body: JSON.stringify({ message, content: encoded, branch: cfg.branch, ...(sha ? { sha } : {}) }) });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || `HTTP ${res.status}`); }
  return res.json();
}
async function ghIssues(pathSuffix = '', options = {}) {
  return fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues${pathSuffix}`, {
    ...options,
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', ...(options.headers || {}) },
  });
}

/* ================= Onglet Photos ================= */

const folderSelect = document.getElementById('folderSelect');
const newFolderField = document.getElementById('newFolderField');
folderSelect.addEventListener('change', () => newFolderField.classList.toggle('show', folderSelect.value === '__new__'));

async function loadFolderOptions() {
  try {
    const { content } = await fetchJsonFile('photos.json');
    const photos = content || [];
    const folders = Array.from(new Set(photos.map(p => p.folder || 'Général')));
    const cur = folderSelect.value;
    folderSelect.innerHTML = folders.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('') + `<option value="__new__">+ Nouveau dossier…</option>`;
    if (folders.includes(cur)) folderSelect.value = cur;
    newFolderField.classList.toggle('show', folderSelect.value === '__new__' || folders.length === 0);
    renderPhotoLibrary(photos);
  } catch (e) { log('log', `✗ Impossible de charger les dossiers — ${e.message}`); }
}

document.getElementById('refreshLibBtn').addEventListener('click', loadFolderOptions);

function renderPhotoLibrary(photos) {
  const el = document.getElementById('libraryList');
  if (!photos.length) { el.innerHTML = '<p class="hint">Aucune photo publiée pour l\'instant.</p>'; return; }
  const byFolder = {};
  photos.forEach(p => { const f = p.folder || 'Général'; (byFolder[f] = byFolder[f] || []).push(p); });
  el.innerHTML = Object.entries(byFolder).map(([folder, items]) => `
    <div class="lib-folder"><h4>${escapeHtml(folder)} · ${items.length}</h4>
      ${items.map(p => `
        <div class="lib-row"><img src="photos/${p.file}" alt="">
          <span class="name">${escapeHtml(p.caption || p.file)}</span>
          <button class="ghost danger" data-file="${escapeHtml(p.file)}">Supprimer</button>
        </div>`).join('')}
    </div>`).join('');
  el.querySelectorAll('button[data-file]').forEach(btn => btn.addEventListener('click', () => deletePhoto(btn.dataset.file)));
}

async function deletePhoto(file) {
  if (!confirm(`Supprimer définitivement "${file}" du dépôt ?`)) return;
  try {
    const getRes = await ghContents(`photos/${file}?ref=${cfg.branch}`);
    if (!getRes.ok) throw new Error(`Fichier introuvable (HTTP ${getRes.status})`);
    const fileData = await getRes.json();
    const delRes = await ghContents(`photos/${file}`, { method: 'DELETE', body: JSON.stringify({ message: `Suppression photo: ${file}`, sha: fileData.sha, branch: cfg.branch }) });
    if (!delRes.ok) { const err = await delRes.json().catch(() => ({})); throw new Error(err.message || `HTTP ${delRes.status}`); }
    const { content, sha } = await fetchJsonFile('photos.json');
    await writeJsonFile('photos.json', (content || []).filter(p => p.file !== file), sha, `Suppression photo: ${file}`);
    log('log', `✓ "${file}" supprimée.`);
    await loadFolderOptions();
  } catch (e) { log('log', `✗ Échec de la suppression — ${e.message}`); }
}

// Redimensionnement/compression côté navigateur (le "script" d'optimisation)
function resizeImageFile(file, maxDim = 2000, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ dataUrl, base64: dataUrl.split(',')[1] });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

let queue = [];
const drop = document.getElementById('drop');
const fileInput = document.getElementById('fileInput');
const queueEl = document.getElementById('queue');
const uploadBtn = document.getElementById('uploadBtn');

drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); addFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', () => addFiles(fileInput.files));

async function addFiles(fileList) {
  const optimize = document.getElementById('optimizeToggle').checked;
  for (const file of [...fileList].filter(f => f.type.startsWith('image/'))) {
    let dataUrl, base64, ext;
    if (optimize) {
      try { ({ dataUrl, base64 } = await resizeImageFile(file)); ext = 'jpg'; }
      catch (e) {
        const r = await fileToDataUrl(file); dataUrl = r; base64 = r.split(',')[1];
        ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
      }
    } else {
      const r = await fileToDataUrl(file); dataUrl = r; base64 = r.split(',')[1];
      ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, 'jpg'])[1].toLowerCase();
    }
    queue.push({ file, dataUrl, base64, ext, caption: file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), status: 'en attente' });
    renderQueue();
  }
}
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function renderQueue() {
  queueEl.innerHTML = '';
  queue.forEach((item, i) => {
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.innerHTML = `<img src="${item.dataUrl}" alt=""><input type="text" value="${item.caption.replace(/"/g, '&quot;')}" data-i="${i}"><span class="status mono">${item.status}</span>`;
    row.querySelector('input').addEventListener('input', (e) => { queue[i].caption = e.target.value; });
    queueEl.appendChild(row);
    item.el = row.querySelector('.status');
  });
  uploadBtn.disabled = queue.length === 0;
}
document.getElementById('clearBtn').addEventListener('click', () => { queue = []; renderQueue(); });

function sanitizeName(name, ext) {
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const clean = name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${stamp}-${clean || 'photo'}.${ext || 'jpg'}`;
}
function currentFolderName() {
  if (folderSelect.value === '__new__') return document.getElementById('newFolderName').value.trim() || 'Général';
  return folderSelect.value || 'Général';
}

uploadBtn.addEventListener('click', async () => {
  if (!cfg) { alert('Coffre non déverrouillé.'); return; }
  if (queue.length === 0) return;
  const folderName = currentFolderName();
  const folderSlug = slugify(folderName);
  uploadBtn.disabled = true;
  log('log', `Début de l'envoi de ${queue.length} photo(s) vers « ${folderName} »…`);
  const newEntries = [];
  for (const item of queue) {
    item.status = 'envoi…'; if (item.el) item.el.textContent = item.status;
    const filename = sanitizeName(item.file.name, item.ext);
    const path = `${folderSlug}/${filename}`;
    try {
      const res = await ghContents(`photos/${path}`, { method: 'PUT', body: JSON.stringify({ message: `Ajout photo: ${item.caption || filename}`, content: item.base64, branch: cfg.branch }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || `HTTP ${res.status}`); }
      item.status = 'ok'; if (item.el) { item.el.textContent = 'ok'; item.el.classList.add('ok'); }
      newEntries.push({ file: path, caption: item.caption, folder: folderName });
      log('log', `✓ ${path} envoyée.`);
    } catch (e) {
      item.status = 'échec'; if (item.el) { item.el.textContent = 'échec'; item.el.classList.add('err'); }
      log('log', `✗ ${item.file.name} — ${e.message}`);
    }
  }
  if (newEntries.length > 0) {
    try {
      const { content, sha } = await fetchJsonFile('photos.json');
      await writeJsonFile('photos.json', [...(content || []), ...newEntries], sha, `Mise à jour du manifeste (+${newEntries.length})`);
      log('log', `Manifeste mis à jour (+${newEntries.length}). En ligne sous peu.`);
      queue = queue.filter(i => i.status === 'échec');
      renderQueue();
      document.getElementById('newFolderName').value = '';
      await loadFolderOptions();
      folderSelect.value = folderName;
    } catch (e) { log('log', `✗ Échec de mise à jour du manifeste — ${e.message}`); }
  }
  uploadBtn.disabled = queue.length === 0;
});

/* ================= Onglet Notes (journal) ================= */

document.getElementById('previewPostBtn').addEventListener('click', () => {
  const title = document.getElementById('postTitle').value.trim() || 'Sans titre';
  const body = document.getElementById('postBody').value.trim();
  document.getElementById('ppDate').textContent = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  document.getElementById('ppTitle').textContent = title;
  document.getElementById('ppBody').textContent = body;
  document.getElementById('postPreview').style.display = 'block';
});

document.getElementById('publishPostBtn').addEventListener('click', async () => {
  const title = document.getElementById('postTitle').value.trim();
  const body = document.getElementById('postBody').value.trim();
  if (!title || !body) { alert('Titre et texte sont requis.'); return; }
  try {
    const { content, sha } = await fetchJsonFile('posts.json');
    const entry = { id: Date.now(), title, body, date: new Date().toISOString() };
    await writeJsonFile('posts.json', [...(content || []), entry], sha, `Nouvelle note: ${title}`);
    log('postsLog', `✓ Note "${title}" publiée.`);
    document.getElementById('postTitle').value = '';
    document.getElementById('postBody').value = '';
    document.getElementById('postPreview').style.display = 'none';
    await loadPosts();
  } catch (e) { log('postsLog', `✗ Échec de la publication — ${e.message}`); }
});

document.getElementById('refreshPostsBtn').addEventListener('click', loadPosts);

async function loadPosts() {
  try {
    const { content } = await fetchJsonFile('posts.json');
    const posts = content || [];
    const el = document.getElementById('postsList');
    if (!posts.length) { el.innerHTML = '<p class="hint">Aucune note publiée.</p>'; return; }
    el.innerHTML = posts.slice().reverse().map(p => `
      <div class="lib-row"><span class="file-icon">TXT</span>
        <span class="name">${escapeHtml(p.title)}</span>
        <button class="ghost danger" data-id="${p.id}">Supprimer</button>
      </div>`).join('');
    el.querySelectorAll('button[data-id]').forEach(btn => btn.addEventListener('click', () => deletePost(Number(btn.dataset.id))));
  } catch (e) { log('postsLog', `✗ Impossible de charger les notes — ${e.message}`); }
}
async function deletePost(id) {
  if (!confirm('Supprimer cette note ?')) return;
  try {
    const { content, sha } = await fetchJsonFile('posts.json');
    await writeJsonFile('posts.json', (content || []).filter(p => p.id !== id), sha, `Suppression note #${id}`);
    log('postsLog', '✓ Note supprimée.');
    await loadPosts();
  } catch (e) { log('postsLog', `✗ Échec — ${e.message}`); }
}

/* ================= Onglet Fichiers ================= */

const fileFolderSelect = document.getElementById('fileFolderSelect');
const newFileFolderField = document.getElementById('newFileFolderField');
fileFolderSelect.addEventListener('change', () => newFileFolderField.classList.toggle('show', fileFolderSelect.value === '__new__'));

async function loadFileFolderOptions() {
  try {
    const { content } = await fetchJsonFile('files.json');
    const files = content || [];
    const folders = Array.from(new Set(files.map(f => f.folder || 'Général')));
    fileFolderSelect.innerHTML = folders.map(f => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('') + `<option value="__new__">+ Nouveau dossier…</option>`;
    newFileFolderField.classList.toggle('show', fileFolderSelect.value === '__new__' || folders.length === 0);
  } catch (e) {}
}

let fileQueue = [];
const dropFiles = document.getElementById('dropFiles');
const fileFileInput = document.getElementById('fileFileInput');
const fileQueueEl = document.getElementById('fileQueue');
const uploadFilesBtn = document.getElementById('uploadFilesBtn');

dropFiles.addEventListener('click', () => fileFileInput.click());
dropFiles.addEventListener('dragover', (e) => { e.preventDefault(); dropFiles.classList.add('drag'); });
dropFiles.addEventListener('dragleave', () => dropFiles.classList.remove('drag'));
dropFiles.addEventListener('drop', (e) => { e.preventDefault(); dropFiles.classList.remove('drag'); addGenericFiles(e.dataTransfer.files); });
fileFileInput.addEventListener('change', () => addGenericFiles(fileFileInput.files));

function addGenericFiles(fileList) {
  [...fileList].forEach(file => {
    const reader = new FileReader();
    reader.onload = () => {
      fileQueue.push({ file, base64: reader.result.split(',')[1], name: file.name, status: 'en attente' });
      renderFileQueue();
    };
    reader.readAsDataURL(file);
  });
}
function renderFileQueue() {
  fileQueueEl.innerHTML = '';
  fileQueue.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'queue-item';
    const ext = (item.name.match(/\.([a-z0-9]+)$/i) || [, '?'])[1].toUpperCase();
    row.innerHTML = `<span class="file-icon">${ext}</span><span style="flex:1">${escapeHtml(item.name)}</span><span class="status mono">${item.status}</span>`;
    fileQueueEl.appendChild(row);
    item.el = row.querySelector('.status');
  });
  uploadFilesBtn.disabled = fileQueue.length === 0;
}
document.getElementById('clearFilesBtn').addEventListener('click', () => { fileQueue = []; renderFileQueue(); });

function currentFileFolderName() {
  if (fileFolderSelect.value === '__new__') return document.getElementById('newFileFolderName').value.trim() || 'Général';
  return fileFolderSelect.value || 'Général';
}

uploadFilesBtn.addEventListener('click', async () => {
  if (!cfg) { alert('Coffre non déverrouillé.'); return; }
  if (fileQueue.length === 0) return;
  const folderName = currentFileFolderName();
  const folderSlug = slugify(folderName);
  uploadFilesBtn.disabled = true;
  const newEntries = [];
  for (const item of fileQueue) {
    item.status = 'envoi…'; if (item.el) item.el.textContent = item.status;
    const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const safeName = item.name.toLowerCase().replace(/[^a-z0-9.\-]+/g, '-');
    const path = `${folderSlug}/${stamp}-${safeName}`;
    try {
      const res = await ghContents(`files/${path}`, { method: 'PUT', body: JSON.stringify({ message: `Ajout fichier: ${item.name}`, content: item.base64, branch: cfg.branch }) });
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.message || `HTTP ${res.status}`); }
      item.status = 'ok'; if (item.el) { item.el.textContent = 'ok'; item.el.classList.add('ok'); }
      newEntries.push({ file: path, name: item.name, folder: folderName, size: item.file.size });
      log('filesLog', `✓ ${item.name} envoyé.`);
    } catch (e) {
      item.status = 'échec'; if (item.el) { item.el.textContent = 'échec'; item.el.classList.add('err'); }
      log('filesLog', `✗ ${item.name} — ${e.message}`);
    }
  }
  if (newEntries.length > 0) {
    try {
      const { content, sha } = await fetchJsonFile('files.json');
      await writeJsonFile('files.json', [...(content || []), ...newEntries], sha, `Mise à jour fichiers (+${newEntries.length})`);
      fileQueue = fileQueue.filter(i => i.status === 'échec');
      renderFileQueue();
      await loadFileFolderOptions();
      await loadFilesLibrary();
    } catch (e) { log('filesLog', `✗ Échec manifeste — ${e.message}`); }
  }
  uploadFilesBtn.disabled = fileQueue.length === 0;
});

document.getElementById('refreshFilesBtn').addEventListener('click', loadFilesLibrary);

async function loadFilesLibrary() {
  try {
    const { content } = await fetchJsonFile('files.json');
    const files = content || [];
    const el = document.getElementById('filesList');
    if (!files.length) { el.innerHTML = '<p class="hint">Aucun fichier publié.</p>'; return; }
    const byFolder = {};
    files.forEach(f => { const fo = f.folder || 'Général'; (byFolder[fo] = byFolder[fo] || []).push(f); });
    el.innerHTML = Object.entries(byFolder).map(([folder, items]) => `
      <div class="lib-folder"><h4>${escapeHtml(folder)} · ${items.length}</h4>
        ${items.map(f => {
          const ext = (f.file.match(/\.([a-z0-9]+)$/i) || [, '?'])[1].toUpperCase();
          return `<div class="lib-row"><span class="file-icon">${ext}</span><span class="name">${escapeHtml(f.name)}</span><button class="ghost danger" data-file="${escapeHtml(f.file)}">Supprimer</button></div>`;
        }).join('')}
      </div>`).join('');
    el.querySelectorAll('button[data-file]').forEach(btn => btn.addEventListener('click', () => deleteFile(btn.dataset.file)));
  } catch (e) { log('filesLog', `✗ Impossible de charger les fichiers — ${e.message}`); }
}
async function deleteFile(path) {
  if (!confirm(`Supprimer "${path}" ?`)) return;
  try {
    const getRes = await ghContents(`files/${path}?ref=${cfg.branch}`);
    if (!getRes.ok) throw new Error(`Introuvable (HTTP ${getRes.status})`);
    const fileData = await getRes.json();
    const delRes = await ghContents(`files/${path}`, { method: 'DELETE', body: JSON.stringify({ message: `Suppression fichier: ${path}`, sha: fileData.sha, branch: cfg.branch }) });
    if (!delRes.ok) { const err = await delRes.json().catch(() => ({})); throw new Error(err.message || `HTTP ${delRes.status}`); }
    const { content, sha } = await fetchJsonFile('files.json');
    await writeJsonFile('files.json', (content || []).filter(f => f.file !== path), sha, `Suppression fichier: ${path}`);
    log('filesLog', `✓ "${path}" supprimé.`);
    await loadFilesLibrary();
  } catch (e) { log('filesLog', `✗ Échec — ${e.message}`); }
}

/* ================= Onglet Modération (livre d'or) ================= */

document.getElementById('refreshModBtn').addEventListener('click', loadModeration);

async function loadModeration() {
  const el = document.getElementById('modList');
  el.innerHTML = '<p class="hint">Chargement…</p>';
  try {
    const res = await ghIssues('?labels=guestbook-pending&state=open&sort=created&direction=asc&per_page=50');
    if (!res.ok) throw new Error(`HTTP ${res.status} — le jeton a-t-il la permission "Issues" ?`);
    const issues = await res.json();
    if (!issues.length) { el.innerHTML = '<p class="hint">Aucun message en attente.</p>'; return; }
    el.innerHTML = issues.map(iss => {
      const name = (iss.title || '').replace(/^\[Livre d'or\]\s*/, '') || 'Anonyme';
      return `
        <div class="mod-item">
          <div class="mi-head"><span class="mi-name">${escapeHtml(name)}</span><span class="mi-date mono">${new Date(iss.created_at).toLocaleDateString('fr-FR')}</span></div>
          <p>${escapeHtml(iss.body || '')}</p>
          <div class="mi-actions">
            <button class="primary" data-action="publish" data-num="${iss.number}" data-name="${escapeHtml(name)}">Publier</button>
            <button class="ghost danger" data-action="reject" data-num="${iss.number}">Rejeter</button>
          </div>
        </div>`;
    }).join('');
    el.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => btn.dataset.action === 'publish' ? publishGuestbookIssue(btn) : rejectGuestbookIssue(btn));
    });
  } catch (e) { el.innerHTML = `<p class="hint" style="color:#c9705a">✗ ${escapeHtml(e.message)}</p>`; }
}

async function publishGuestbookIssue(btn) {
  const num = btn.dataset.num;
  const name = btn.dataset.name;
  btn.disabled = true;
  try {
    const issueRes = await ghIssues(`/${num}`);
    if (!issueRes.ok) throw new Error(`HTTP ${issueRes.status}`);
    const issue = await issueRes.json();
    const { content, sha } = await fetchJsonFile('guestbook.json');
    const entry = { id: issue.number, name, message: issue.body || '', date: issue.created_at };
    await writeJsonFile('guestbook.json', [...(content || []), entry], sha, `Publication message livre d'or #${num}`);
    await ghIssues(`/${num}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', labels: ['guestbook-published'] }) });
    log('modLog', `✓ Message de ${name} publié.`);
    await loadModeration();
  } catch (e) { log('modLog', `✗ Échec — ${e.message}`); btn.disabled = false; }
}
async function rejectGuestbookIssue(btn) {
  const num = btn.dataset.num;
  btn.disabled = true;
  try {
    await ghIssues(`/${num}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', labels: ['guestbook-rejected'] }) });
    log('modLog', `Message #${num} rejeté.`);
    await loadModeration();
  } catch (e) { log('modLog', `✗ Échec — ${e.message}`); btn.disabled = false; }
}

/* ================= Onglet Configuration ================= */

async function loadConfig() {
  try {
    const { content } = await fetchJsonFile('site-config.json');
    const c = content || { contactEmail: '', guestbook: {} };
    document.getElementById('cfgContactEmail').value = c.contactEmail || '';
    document.getElementById('cfgGbEnabled').checked = !!(c.guestbook && c.guestbook.enabled);
    document.getElementById('cfgGbToken').value = (c.guestbook && c.guestbook.publicToken) || '';
  } catch (e) { log('configLog', `✗ Impossible de charger la configuration — ${e.message}`); }
}

document.getElementById('saveConfigBtn').addEventListener('click', async () => {
  const contactEmail = document.getElementById('cfgContactEmail').value.trim();
  const enabled = document.getElementById('cfgGbEnabled').checked;
  const publicToken = document.getElementById('cfgGbToken').value.trim();
  if (enabled && !publicToken) { alert('Le jeton public est requis pour activer le livre d\'or.'); return; }
  if (enabled && !confirm('Ce jeton sera écrit EN CLAIR dans un fichier public du dépôt. Confirmes-tu qu\'il est bien limité à "Issues: write" sur ce seul dépôt ?')) return;
  const configObj = { contactEmail, guestbook: { enabled, owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, publicToken } };
  try {
    const { sha } = await fetchJsonFile('site-config.json');
    await writeJsonFile('site-config.json', configObj, sha, 'Mise à jour configuration du site');
    log('configLog', '✓ Configuration enregistrée et publiée.');
  } catch (e) { log('configLog', `✗ Échec — ${e.message}`); }
});

document.getElementById('refreshPreviewBtn').addEventListener('click', async () => {
  const el = document.getElementById('fullPreview');
  el.innerHTML = '<p class="preview-hint">Chargement…</p>';
  try {
    const [photos, posts, gb] = await Promise.all([fetchJsonFile('photos.json'), fetchJsonFile('posts.json'), fetchJsonFile('guestbook.json')]);
    const p = photos.content || [], po = posts.content || [], g = gb.content || [];
    const folders = Array.from(new Set(p.map(x => x.folder || 'Général')));
    el.innerHTML = `
      <p class="preview-hint">Aperçu — état actuel du site public</p>
      <p>📷 <strong>${p.length}</strong> photo(s) dans <strong>${folders.length}</strong> dossier(s) : ${escapeHtml(folders.join(', ') || '—')}</p>
      <p>📝 <strong>${po.length}</strong> note(s) publiée(s)${po.length ? ' — dernière : « ' + escapeHtml(po[po.length - 1].title) + ' »' : ''}</p>
      <p>💬 <strong>${g.length}</strong> message(s) dans le livre d'or</p>
    `;
  } catch (e) { el.innerHTML = `<p class="preview-hint" style="color:#c9705a">✗ ${escapeHtml(e.message)}</p>`; }
});
