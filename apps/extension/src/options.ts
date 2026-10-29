// Options page: paste the pairing token the Baton app shows, once.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LABELS: Record<string, string> = {
  unpaired: 'Not paired yet. Paste the token from the Baton app.',
  connecting: 'Connecting to the Baton app…',
  connected: 'Connected to the Baton app.',
  rejected: 'The Baton app refused this token. Copy it again from the app.',
  offline: 'Paired, but the Baton app is not running. Start it and this connects by itself.',
};

async function render() {
  const { token, port, status, statusDetail } = await chrome.storage.local.get(['token', 'port', 'status', 'statusDetail']);
  if (token && !$<HTMLInputElement>('token').value) $<HTMLInputElement>('token').placeholder = 'Saved. Paste a new token to replace it.';
  $<HTMLInputElement>('port').value = String(port ?? 4317);
  const s = String(status ?? 'unpaired');
  $('status').textContent = LABELS[s] ?? s;
  $('status').dataset.status = s;
  $('detail').textContent = s === 'rejected' && statusDetail ? `Reason: ${statusDetail}` : '';
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $<HTMLInputElement>('token').value.trim();
  const port = Number($<HTMLInputElement>('port').value) || 4317;
  if (token && !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    $('status').textContent = 'That does not look like a Baton pairing token (43 letters, digits, - or _).';
    $('status').dataset.status = 'rejected';
    return;
  }
  const update: Record<string, unknown> = token ? { token, port } : { port };
  await chrome.storage.local.set(update);
  $<HTMLInputElement>('token').value = '';
  await render();
});

chrome.storage.onChanged.addListener(() => void render());
void render();
