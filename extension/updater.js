// weteleporting - updater (shared by service worker, popup and the update page)
// Flow: read update.json -> compare version -> download every listed file -> verify SHA-256
//       -> write them into the user's linked extension folder -> chrome.runtime.reload().
const WT_FILE_RE = /^[A-Za-z0-9_\-][A-Za-z0-9_\-./]*$/;

function wtCmp(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 4; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
async function wtGetUpdateUrl() {
  const { updateUrl } = await chrome.storage.local.get('updateUrl');
  const u = (updateUrl || (typeof WT_UPDATE_URL !== 'undefined' ? WT_UPDATE_URL : '') || '').trim();
  return /^https:\/\//.test(u) && !u.includes('YOUR-GITHUB-NAME') ? u : '';
}
function wtValidate(j) {
  if (!j || typeof j !== 'object') throw new Error('The update file is not valid');
  if (!/^\d+(\.\d+){0,3}$/.test(String(j.version))) throw new Error('The update file has a bad version');
  if (!/^https:\/\//.test(j.base || '')) throw new Error('The update file needs an https "base" address');
  if (!j.files || typeof j.files !== 'object' || !j.files['manifest.json']) throw new Error('The update file must list manifest.json');
  for (const [name, hash] of Object.entries(j.files)) {
    if (!WT_FILE_RE.test(name) || name.includes('..') || name.includes('//')) throw new Error('Unsafe file name in update: ' + name);
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Missing checksum for ' + name);
  }
  return { ...j, version: String(j.version), base: j.base.endsWith('/') ? j.base : j.base + '/' };
}
async function wtSha(buf) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function wtBadge(on) {
  try { chrome.action.setBadgeText({ text: on ? '↑' : '' }); if (on) chrome.action.setBadgeBackgroundColor({ color: '#ff6b9d' }); } catch {}
}

// ---------- check ----------
async function wtCheckUpdate() {
  const current = chrome.runtime.getManifest().version, checkedAt = Date.now();
  let info;
  const url = await wtGetUpdateUrl();
  if (!url) info = { ok: false, error: 'Update source is not set up yet.', current, checkedAt };
  else {
    try {
      const res = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not reach the update server (HTTP ' + res.status + ')');
      const j = wtValidate(await res.json());
      info = { ok: true, current, latest: j.version, available: wtCmp(j.version, current) > 0, notes: String(j.notes || '').slice(0, 1500), update: j, checkedAt };
    } catch (e) { info = { ok: false, error: e.message || String(e), current, checkedAt }; }
  }
  await chrome.storage.local.set({ updateInfo: info });
  wtBadge(!!info.available);
  return info;
}

// ---------- linked folder (File System Access handle kept in IndexedDB) ----------
function wtIdb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('wt-updater', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function wtDirGet() {
  try { const db = await wtIdb(); return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('dir'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
  catch { return null; }
}
async function wtDirSet(handle) {
  const db = await wtIdb();
  return new Promise((res, rej) => { const q = db.transaction('kv', 'readwrite').objectStore('kv').put(handle, 'dir'); q.onsuccess = () => res(); q.onerror = () => rej(q.error); });
}
async function wtCheckFolder(handle) {   // make sure the chosen folder really is this extension
  let text;
  try { text = await (await (await handle.getFileHandle('manifest.json')).getFile()).text(); }
  catch { throw new Error('manifest.json was not found in that folder. Pick the folder you loaded in chrome://extensions.'); }
  const m = JSON.parse(text);
  if (m.name !== chrome.runtime.getManifest().name) throw new Error('That folder is a different extension.');
  return m;
}
async function wtWrite(root, path, buf) {
  const parts = path.split('/'), name = parts.pop(); let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(buf); await w.close();
}

// ---------- apply ----------
async function wtApplyUpdate(update, handle, log = () => {}) {
  update = wtValidate(update);
  await wtCheckFolder(handle);
  const names = Object.keys(update.files), got = {};
  log(`Downloading ${names.length} files…`);
  for (const n of names) {
    const res = await fetch(update.base + n + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not download ${n} (HTTP ${res.status})`);
    const buf = await res.arrayBuffer();
    if ((await wtSha(buf)) !== update.files[n])
      throw new Error(`${n} does not match its checksum. The files may still be syncing on the server. Wait a few minutes and try again.`);
    got[n] = buf;
  }
  const mf = JSON.parse(new TextDecoder().decode(got['manifest.json']));
  if (mf.version !== update.version) throw new Error('The downloaded manifest version does not match the update file.');
  if (mf.name !== chrome.runtime.getManifest().name) throw new Error('The downloaded files belong to a different extension.');
  log('All files verified ✔. Installing…');
  for (const n of names.filter((x) => x !== 'manifest.json')) await wtWrite(handle, n, got[n]);
  await wtWrite(handle, 'manifest.json', got['manifest.json']);   // manifest last, so a failure never leaves a half-update
  await chrome.storage.local.set({ updateInfo: { ok: true, current: update.version, latest: update.version, available: false, checkedAt: Date.now() } });
  wtBadge(false);
  log(`Installed v${update.version} ✔. Reloading the extension…`);
  setTimeout(() => chrome.runtime.reload(), 900);
}
