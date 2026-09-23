const $ = id => document.getElementById(id);
let lastMessages = '', imageUrl, currentState, polling = false;
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw Error(result.error || 'Request failed'); return result;
}
function prose(text) {
  const fragment = document.createDocumentFragment();
  for (const part of text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s<>]+)/g)) {
    let node;
    if (part.startsWith('**') && part.endsWith('**')) { node = document.createElement('b'); node.textContent = part.slice(2, -2); }
    else if (part.startsWith('`') && part.endsWith('`')) { node = document.createElement('code'); node.textContent = part.slice(1, -1); }
    else if (/^https?:\/\//.test(part)) { node = document.createElement('a'); node.href = part; node.textContent = part; node.target = '_blank'; node.rel = 'noreferrer noopener'; }
    else node = document.createTextNode(part);
    fragment.append(node);
  }
  return fragment;
}
function notice(text) { $('notice').textContent = text; }
function tab(name) {
  for (const button of document.querySelectorAll('[data-tab]')) button.classList.toggle('selected', button.dataset.tab === name);
  for (const panel of ['browser', 'sandbox', 'activity']) $(`${panel}-panel`).hidden = panel !== name;
  if (name === 'sandbox' && currentState && !$('preview').src) $('preview').src = currentState.previewUrl;
}
for (const button of document.querySelectorAll('[data-tab]')) button.onclick = () => tab(button.dataset.tab);
for (const button of document.querySelectorAll('[data-prompt]')) button.onclick = () => { $('direction').value = button.dataset.prompt; $('direction').focus(); };
$('compose').onsubmit = async event => {
  event.preventDefault(); const message = $('direction').value.trim(); if (!message) return;
  $('send').disabled = true;
  try { await api('/api/message', { message }); $('direction').value = ''; notice('Working on your direction. Follow the steps in Activity.'); await refresh(); }
  catch (error) { notice(error.message); $('send').disabled = false; }
};
$('stop').onclick = async () => { try { await api('/api/stop', {}); notice('Stopping after the current operation settles.'); } catch (error) { notice(error.message); } };
async function screenshot() {
  try {
    const response = await fetch('/api/browser.png'); if (!response.ok || response.status === 204) return;
    const next = URL.createObjectURL(await response.blob()); const prior = imageUrl; imageUrl = next;
    $('browser-image').src = next; $('browser-image').hidden = false; $('browser-empty').hidden = true;
    if (prior) URL.revokeObjectURL(prior);
  } catch { /* Keep the last good frame; health is reported by state polling. */ }
}
$('refresh-browser').onclick = screenshot;
$('refresh-preview').onclick = () => { if (currentState) $('preview').src = currentState.previewUrl; };
async function refresh() {
  if (polling) return; polling = true;
  try {
    const state = await api('/api/state'); currentState = state;
    $('status').textContent = state.working ? 'Working' : 'Ready'; $('model').textContent = state.model;
    $('send').disabled = state.working; $('stop').hidden = !state.working;
    $('inspector').href = state.inspectorUrl; $('preview-link').href = state.previewUrl;
    $('browser-count').textContent = state.browsers.length; $('service-count').textContent = state.services.length;
    $('browser-state').textContent = state.browsers.length ? `Browser · ${state.working ? 'agent has control' : 'session retained'}` : 'No browser open';
    $('sandbox-state').textContent = `${state.sandboxes.length} persistent workspace · Node 22`;
    $('run-status').textContent = state.run?.status ?? 'Ready for your direction';
    document.body.classList.toggle("has-messages", state.messages.length > 0);
    const signature = JSON.stringify(state.messages);
    if (signature !== lastMessages) {
      lastMessages = signature; $('messages').replaceChildren();
      for (const message of state.messages) {
        const item = document.createElement('div'); item.className = `message ${message.role}`;
        const label = document.createElement('strong'); label.textContent = message.role === 'user' ? 'You' : 'Operator';
        item.append(label, prose(message.text)); $('messages').append(item);
      }
      $('messages').scrollTop = $('messages').scrollHeight;
    }
    $('services').replaceChildren();
    for (const service of state.services) { const label = document.createElement('span'); label.className = 'service'; label.textContent = `${service.name} · ${service.status}`; $('services').append(label); }
    if (!state.services.length) $('services').textContent = 'Ask Operator to build something and start its server.';
    if (state.trace.length) {
      $('activity').replaceChildren();
      for (const step of state.trace) { const item = document.createElement('li'); item.textContent = `${new Date(step.at).toLocaleTimeString()}  ${step.name || step.type}`; $('activity').append(item); }
    }
    if (state.run?.error) notice(state.run.error);
    if (!state.working && !$('browser-panel').hidden) await screenshot();
  } catch { $('status').textContent = 'Disconnected'; notice('Operator is not responding. Start it with pnpm start and refresh.'); }
  finally { polling = false; }
}
await refresh(); setInterval(refresh, 3000);
