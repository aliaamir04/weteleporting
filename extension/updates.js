const $ = (id) => document.getElementById(id);
const log = (t, cls) => { $('log').textContent += '\n' + t; $('log').scrollTop = 1e9; };
let info = null, dir = null;

async function perm(h, ask) {
  let p = await h.queryPermission({ mode: 'readwrite' });
  if (p !== 'granted' && ask) p = await h.requestPermission({ mode: 'readwrite' });
  return p === 'granted';
}
async function render() {
  chrome.runtime.sendMessage({ type: 'get-state' }).then((s) => s && s.theme && wtApplyVars(document.documentElement, Object.assign({}, WT_DEFAULT_THEME, s.theme))).catch(() => {});
  $('cur').textContent = 'v' + chrome.runtime.getManifest().version;
  info = (await chrome.storage.local.get('updateInfo')).updateInfo || null;
  dir = await wtDirGet();
  if (dir) { const ok = await dir.queryPermission({ mode: 'readwrite' }); $('folder').innerHTML = `Linked folder: <b class="ok">${dir.name} ✔</b>` + (ok === 'granted' ? '' : ' (Chrome will ask permission again when you install)'); }
  else $('folder').innerHTML = '<span class="bad">No folder linked yet.</span>';
  const pill = $('pill');
  if (!info) { pill.textContent = 'not checked'; pill.className = 'pill'; }
  else if (!info.ok) { pill.textContent = 'error'; pill.className = 'pill'; $('notes').textContent = info.error || ''; }
  else if (info.available) { pill.textContent = 'v' + info.latest + ' available'; pill.className = 'pill new'; $('notes').textContent = info.notes || ''; }
  else { pill.textContent = 'up to date ✓'; pill.className = 'pill'; $('notes').textContent = ''; }
  $('install').disabled = !(info && info.available && dir);
}
$('link').onclick = async () => {
  try {
    const h = await showDirectoryPicker({ id: 'wt-extension', mode: 'readwrite' });
    await wtCheckFolder(h); await wtDirSet(h); log('Folder linked: ' + h.name + ' ✔'); await render();
  } catch (e) { if (e.name !== 'AbortError') log('⚠ ' + e.message); }
};
$('check').onclick = async () => {
  $('check').disabled = true; log('Checking…');
  const r = await wtCheckUpdate(); await render();
  log(!r.ok ? '⚠ ' + r.error : r.available ? `Update found: v${r.latest}` : 'You already have the latest version ✔');
  $('check').disabled = false;
};
$('install').onclick = async () => {
  try {
    const st = await chrome.runtime.sendMessage({ type: 'get-state' });
    if (st && st.phase === 'connected' && !confirm('You are in a room. Updating will disconnect it. Continue?')) return;
    if (!(await perm(dir, true))) return log('⚠ Permission to edit the folder was not granted.');
    $('install').disabled = true;
    await wtApplyUpdate(info.update, dir, log);
  } catch (e) { log('⚠ ' + (e.message || e)); $('install').disabled = false; }
};
(async () => {
  await render();
  if (!info || Date.now() - info.checkedAt > 60000) { const r = await wtCheckUpdate(); await render(); if (!r.ok) log('⚠ ' + r.error); }
  if (info && info.available && dir && new URLSearchParams(location.search).get('auto') && (await perm(dir, false))) $('install').click();
})();
