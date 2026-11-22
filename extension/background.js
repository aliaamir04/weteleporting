// weteleporting - background service worker
importScripts('config.js', 'updater.js');
// Chat history, theme, sync routing, ad-blocker switch. The peer link lives in offscreen.js.

const blank = () => ({
  phase: 'idle',            // idle | hosting | joining | connected
  mode: 'code',             // code | manual
  host: false, error: null,
  roomCode: null, offerCode: null, answerCode: null,
  partner: null, partnerKey: null, partnerUrl: null, partnerTitle: null, partnerV: null,
  chat: []
});
let S = { ...blank(), name: '', chatHidden: false, theme: { id: 'rose', wall: 'hearts', glow: false }, myKey: null, myUrl: null, myTitle: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const THEME_IDS = ['rose', 'midnight', 'sunset', 'ocean', 'forest', 'lavender', 'gold', 'ivory'];
const WALLS = ['none', 'hearts', 'stars', 'dots', 'lines', 'aurora'];

async function syncAdblock() {
  const { adblock } = await chrome.storage.local.get('adblock');
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets(adblock === false ? { disableRulesetIds: ['ads'] } : { enableRulesetIds: ['ads'] });
  } catch {}
}
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.adblock) syncAdblock(); });
chrome.runtime.onInstalled.addListener(syncAdblock);

const ready = (async () => {
  const local = await chrome.storage.local.get(['name', 'chatHidden', 'theme']);
  const sess = await chrome.storage.session.get('S');
  if (sess.S) S = { ...S, ...sess.S };
  if (local.name) S.name = local.name;
  if (typeof local.chatHidden === 'boolean') S.chatHidden = local.chatHidden;
  if (local.theme) S.theme = { ...S.theme, ...local.theme };
  syncAdblock();
  if (S.phase !== 'idle') {   // after a service-worker restart check the link is still alive
    if (!(await hasOffscreen())) Object.assign(S, blank());
    else {
      const r = await rtc('status');
      if (S.phase === 'connected' && !(r.ok && r.open)) Object.assign(S, blank(), { error: '💔 Connection lost. Create a new room.' });
    }
  }
})();

// ---------- peer link (via offscreen document) ----------
let creating = null;
async function hasOffscreen() { return (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0; }
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) creating = chrome.offscreen.createDocument({
    url: 'offscreen.html', reasons: ['WEB_RTC'], justification: 'Direct peer-to-peer link with your partner'
  }).finally(() => (creating = null));
  await creating;
}
async function rtc(cmd, extra = {}) {
  try { await ensureOffscreen(); } catch (e) { return { ok: false, error: e.message }; }
  for (let i = 0; i < 25; i++) {
    try { const r = await chrome.runtime.sendMessage({ target: 'offscreen', cmd, ...extra }); if (r) return r; } catch {}
    await sleep(150);
  }
  return { ok: false, error: 'Could not start the connection engine' };
}
const send = (d) => chrome.runtime.sendMessage({ target: 'offscreen', cmd: 'send', d }).catch(() => {});

// ---------- helpers ----------
function keyOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname.replace(/^www\./, '');
    if (h.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (u.pathname === '/watch' && v) return 'yt:' + v;
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/);
      if (m) return 'yt:' + m[2];
    }
    if (h === 'youtu.be') return 'yt:' + u.pathname.slice(1);
    const drop = /^(utm_.*|t|si|fbclid|feature|start|time_continue|gclid|ref|pp|list|index)$/;
    const keep = [...u.searchParams.entries()].filter(([k]) => !drop.test(k)).sort();
    return h + u.pathname.replace(/\/$/, '') + (keep.length ? '?' + keep.map(([k, v]) => k + '=' + v).join('&') : '');
  } catch { return null; }
}
const synced = () => !!(S.phase === 'connected' && S.partner && S.myKey && S.myKey === S.partnerKey);
const pub = () => ({ ...S, synced: synced() });
async function save() { await chrome.storage.session.set({ S }); await chrome.storage.local.set({ name: S.name, chatHidden: S.chatHidden, theme: S.theme }); }
async function broadcast() {
  save();
  const state = pub();
  chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});
  for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, { type: 'state', state }).catch(() => {});
}
async function toastAll(text) {
  for (const t of await chrome.tabs.query({ active: true })) chrome.tabs.sendMessage(t.id, { type: 'toast', text }, { frameId: 0 }).catch(() => {});
}
function addChat(m) { S.chat.push({ ts: Date.now(), ...m }); if (S.chat.length > 200) S.chat.shift(); }
function sendHello() { send({ kind: 'hello', name: S.name, key: S.myKey, url: S.myUrl, title: S.myTitle, v: chrome.runtime.getManifest().version }); }
function leaveLocal(note) { rtc('close'); Object.assign(S, blank(), { error: note || null }); broadcast(); if (note) toastAll(note); }
function cleanTheme(t) {
  const o = { ...S.theme };
  if (t && THEME_IDS.includes(t.id)) o.id = t.id;
  if (t && WALLS.includes(t.wall)) o.wall = t.wall;
  if (t && typeof t.glow === 'boolean') o.glow = t.glow;
  return o;
}

// ---------- peer messages ----------
async function onPeer(d) {
  if (d.kind === 'hello') {
    const was = synced(), first = !S.partner;
    S.partner = String(d.name || 'Partner').slice(0, 24); S.partnerKey = d.key; S.partnerUrl = d.url; S.partnerTitle = d.title;
    if (first) addChat({ from: 'sys', text: `Connected with ${S.partner} 💞` });
    if (d.v && d.v !== S.partnerV) { S.partnerV = d.v; const me = chrome.runtime.getManifest().version; if (d.v !== me) addChat({ from: 'sys', text: `${S.partner} is on v${d.v} and you are on v${me}. Update the older one (Settings → Updates) for best sync.` }); }
    if (!was && synced()) addChat({ from: 'sys', text: '✨ Teleport started. You are both on the same content.' });
    if (was && !synced()) addChat({ from: 'sys', text: `${S.partner} moved to a different page.` });
    broadcast();
    if (synced() && S.host) pushFromTab();
  } else if (d.kind === 'chat') { addChat({ from: 'partner', name: S.partner, text: String(d.text).slice(0, 1000) }); broadcast(); }
  else if (d.kind === 'link') { addChat({ from: 'partner', name: S.partner, text: String(d.title || d.url).slice(0, 200), url: d.url, link: true }); broadcast(); }
  else if (d.kind === 'theme') {
    const changed = JSON.stringify(cleanTheme(d.theme)) !== JSON.stringify(S.theme);
    S.theme = cleanTheme(d.theme);
    if (changed) addChat({ from: 'sys', text: `${S.partner || 'Partner'} changed the look ✨` });
    broadcast();
  } else if (d.kind === 'typing') {
    for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, { type: 'typing' }, { frameId: 0 }).catch(() => {});
  } else if (d.kind === 'react') {
    for (const t of await chrome.tabs.query({})) chrome.tabs.sendMessage(t.id, { type: 'react', emoji: d.emoji }, { frameId: 0 }).catch(() => {});
  } else if (d.kind === 'sync') {
    if (!synced()) return;
    for (const t of await chrome.tabs.query({})) if (keyOf(t.url) === S.partnerKey) chrome.tabs.sendMessage(t.id, { type: 'apply', d }).catch(() => {});
  } else if (d.kind === 'end') leaveLocal('Room was ended by your partner 💔');
  else if (d.kind === 'bye') leaveLocal('Your partner left the room');
}
async function pushFromTab() {
  for (const t of await chrome.tabs.query({})) if (S.myKey && keyOf(t.url) === S.myKey) chrome.tabs.sendMessage(t.id, { type: 'push' }).catch(() => {});
}
async function updateMyTab() {
  await ready;
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!t) return;
  const key = keyOf(t.url);
  if (key === S.myKey && t.url === S.myUrl) return;
  S.myKey = key; S.myUrl = t.url; S.myTitle = t.title || '';
  if (S.phase === 'connected') { sendHello(); broadcast(); }
}
chrome.tabs.onActivated.addListener(updateMyTab);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url || info.status === 'complete') updateMyTab(); });
chrome.windows.onFocusChanged.addListener(updateMyTab);
chrome.commands.onCommand.addListener(async (c) => { if (c === 'toggle-chat') { await ready; S.chatHidden = !S.chatHidden; broadcast(); } });

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.target === 'offscreen') return;
  (async () => {
    await ready;
    const brokerOpt = async () => ({ broker: (await chrome.storage.local.get('broker')).broker || '' });
    switch (msg.type) {
      // from offscreen
      case 'rtc-open':
        if (S.phase === 'idle') break;
        S.phase = 'connected'; S.error = null; S.roomCode = S.offerCode = S.answerCode = null;
        await updateMyTab(); sendHello();
        if (S.host) send({ kind: 'theme', theme: S.theme });
        broadcast(); break;
      case 'rtc-close': if (S.phase !== 'idle') leaveLocal('💔 Connection lost. Create a new room to reconnect.'); break;
      case 'rtc-fail': if (S.phase !== 'idle') leaveLocal(msg.error); break;
      case 'rtc-msg': if (S.phase === 'connected') onPeer(msg.d); break;
      case 'rtc-ping': break;

      // from popup: 6-digit code mode
      case 'host-code': {
        Object.assign(S, blank(), { phase: 'hosting', host: true, mode: 'code' });
        S.name = (msg.name || 'Me').slice(0, 24); broadcast();
        const r = await rtc('host-start', await brokerOpt());
        if (!r.ok) leaveLocal(r.error); else { S.roomCode = r.code; broadcast(); }
        break; }
      case 'join-code': {
        Object.assign(S, blank(), { phase: 'joining', host: false, mode: 'code' });
        S.name = (msg.name || 'Me').slice(0, 24); broadcast();
        const r = await rtc('join-start', { code: msg.code, ...(await brokerOpt()) });
        if (!r.ok) leaveLocal(r.error);
        break; }
      // manual mode (backup)
      case 'manual-host': {
        Object.assign(S, blank(), { phase: 'hosting', host: true, mode: 'manual' });
        S.name = (msg.name || 'Me').slice(0, 24); broadcast();
        const r = await rtc('create');
        if (!r.ok) leaveLocal('Could not create the room: ' + r.error); else { S.offerCode = r.code; broadcast(); }
        break; }
      case 'manual-accept': {
        const r = await rtc('accept-answer', { code: msg.code });
        S.error = r.ok ? null : 'That reply code is not valid. Ask your partner to send it again.'; broadcast(); break; }
      case 'manual-join': {
        Object.assign(S, blank(), { phase: 'joining', host: false, mode: 'manual' });
        S.name = (msg.name || 'Me').slice(0, 24); broadcast();
        const r = await rtc('accept-offer', { code: msg.code });
        if (!r.ok) Object.assign(S, blank(), { error: 'That invite code is not valid.' }); else S.answerCode = r.code;
        broadcast(); break; }
      case 'get-state': await updateMyTab(); respond(pub()); return;
      case 'cancel': leaveLocal(); break;
      case 'leave': send({ kind: 'bye' }); await sleep(250); leaveLocal(); break;
      case 'end': send({ kind: 'end' }); await sleep(250); leaveLocal(); break;

      // chat + shared look
      case 'chat': {
        const text = String(msg.text || '').slice(0, 1000); if (!text.trim()) break;
        addChat({ from: 'me', name: S.name, text }); send({ kind: 'chat', text }); broadcast(); break; }
      case 'typing': send({ kind: 'typing' }); break;
      case 'react': send({ kind: 'react', emoji: msg.emoji }); break;
      case 'set-theme':
        S.theme = cleanTheme(msg.theme);
        if (S.phase === 'connected') send({ kind: 'theme', theme: S.theme });
        broadcast(); break;
      case 'send-link': {
        const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (t && keyOf(t.url)) {
          const title = (t.title || t.url).slice(0, 120);
          send({ kind: 'link', url: t.url, title: '💌 ' + title });
          addChat({ from: 'me', name: S.name, text: '💌 You sent this page: ' + title }); broadcast();
        } break; }
      case 'toggle-chat': S.chatHidden = msg.value ?? !S.chatHidden; broadcast(); break;
      case 'clear-chat': S.chat = []; broadcast(); break;
      case 'resync': await updateMyTab(); pushFromTab(); break;
      case 'open-url':
      case 'open-partner': {
        const url = msg.type === 'open-url' ? msg.url : S.partnerUrl;
        if (!/^https?:\/\//.test(url || '')) break;
        const id = sender.tab ? sender.tab.id : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
        if (id) chrome.tabs.update(id, { url }); break; }

      // from content scripts
      case 'sync': if (sender.tab && synced() && keyOf(sender.tab.url) === S.partnerKey) send({ kind: 'sync', ...msg.d }); break;
      case 'toast': if (sender.tab) chrome.tabs.sendMessage(sender.tab.id, { type: 'toast', text: msg.text }, { frameId: 0 }).catch(() => {}); break;
    }
    respond(pub());
  })();
  return true;
});

// ---------- auto-update checker ----------
chrome.alarms.create('wt-update', { periodInMinutes: 15 });
async function autoCheck() {
  const { autoUpdateCheck, notifiedVersion } = await chrome.storage.local.get(['autoUpdateCheck', 'notifiedVersion']);
  if (autoUpdateCheck === false) return;
  const info = await wtCheckUpdate();
  if (info.available && notifiedVersion !== info.latest) {
    await chrome.storage.local.set({ notifiedVersion: info.latest });
    toastAll(`⬆ weteleporting v${info.latest} is ready. Open 💞 → Settings → Updates.`);
  }
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'wt-update') autoCheck(); });
chrome.runtime.onStartup.addListener(autoCheck);
chrome.runtime.onInstalled.addListener(autoCheck);
