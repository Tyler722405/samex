const MISTRAL_ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_MODEL = 'mistral-small-latest';

function setAiStatus(message, type = '') {
  const status = document.getElementById('mistralStatus');
  if (!status) return;
  status.className = `form-status${type ? ` ${type}` : ''}`;
  status.textContent = message;
}

function showAnswer(text) {
  const response = document.getElementById('mistralResponse');
  const answer = document.getElementById('mistralAnswer');
  if (!response || !answer) return;
  answer.textContent = text;
  response.hidden = false;
}

async function askMistral() {
  const keyInput = document.getElementById('mistralKey');
  const promptInput = document.getElementById('mistralPrompt');
  const sendButton = document.getElementById('mistralSend');
  const key = keyInput?.value.trim() || '';
  const prompt = promptInput?.value.trim() || '';

  if (!key || !prompt) {
    setAiStatus('Renseigne la clé API et un message.', 'err');
    return;
  }

  sendButton.disabled = true;
  setAiStatus('Mistral prépare une réponse…');

  try {
    const response = await fetch(MISTRAL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        temperature: 0.7,
        messages: [
          { role: 'system', content: 'Tu es un assistant utile. Réponds en français, clairement et brièvement.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || data?.error?.message || `Erreur Mistral (${response.status})`);
    }

    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('Mistral n’a renvoyé aucune réponse.');
    showAnswer(answer);
    setAiStatus('Réponse reçue.', 'ok');
  } catch (error) {
    console.warn('Requête Mistral impossible', error);
    setAiStatus(error.message || 'La requête Mistral a échoué.', 'err');
  } finally {
    sendButton.disabled = false;
  }
}

function clearAi() {
  document.getElementById('mistralPrompt').value = '';
  document.getElementById('mistralResponse').hidden = true;
  document.getElementById('mistralAnswer').textContent = '';
  setAiStatus('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('mistralSend')?.addEventListener('click', askMistral);
  document.getElementById('mistralClear')?.addEventListener('click', clearAi);
});
