const CONTACT_CONFIG_URL = 'site-config.json';

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} (${res.status})`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function initContactPage() {
  const statusEl = document.getElementById('cStatus');
  const form = document.getElementById('contactForm');
  const submitBtn = document.getElementById('cSubmit');
  const disabledHint = document.getElementById('cDisabledHint');

  let cfg = {};
  try { cfg = await fetchJson(CONTACT_CONFIG_URL).catch(() => ({})); } catch (error) { console.warn('site-config.json introuvable', error); }

  const email = (cfg && cfg.contactEmail) || '';
  if (!email) {
    if (disabledHint) disabledHint.hidden = false;
    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) statusEl.textContent = 'Aucune adresse email n\'est configurée.';
    return;
  }

  if (disabledHint) disabledHint.hidden = true;
  if (submitBtn) submitBtn.disabled = false;

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = document.getElementById('cName')?.value?.trim() || '';
    const subject = document.getElementById('cSubject')?.value?.trim() || 'Message via le site';
    const message = document.getElementById('cMessage')?.value?.trim() || '';
    const href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`Nom : ${name}\n\nMessage :\n${message}`)}`;
    window.location.href = href;
    if (statusEl) {
      statusEl.className = 'form-status ok';
      statusEl.textContent = 'Votre messagerie a été ouverte.';
    }
    form.reset();
  });
}

document.addEventListener('DOMContentLoaded', initContactPage);
