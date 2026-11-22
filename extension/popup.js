const $ = (id) => document.getElementById(id);
const bg = (m) => chrome.runtime.sendMessage(m);
const VIEWS = ['home', 'hostcode', 'connecting', 'room', 'mHome', 'mHost', 'mJoin', 'mJoined'];
let localView = 'home', last = null, builtSwatches = false;

const show = (v) => VIEWS.forEach((x) => $(x).classList.toggle('hide', x !== v));
const name = () => ($('name').value.trim() || $('mname').value.trim() || 'Me');
const looksLikeCode = (v) => /^WT1-\S{20,}$/.test(v.replace(/\s+/g, ''));
const digits = (v) => v.replace(/\D/g, '').slice(0, 6);

function buildSettings() {
  Object.keys(WT_THEMES).forEach((id) => {
    const th = WT_THEMES[id], b = document.createElement('button'); b.dataset.id = id;
    b.innerHTML = `<i style="background:linear-gradient(135deg,${th.a},${th.b})"></i>${th.name}`;
    b.onclick = () => bg({ type: 'set-theme', theme: { id } }); $('sw').appendChild(b);
  });
  Object.keys(WT_WALLS).forEach((id) => {
    const b = document.createElement('button'); b.dataset.id = id; b.textContent = WT_WALLS[id];
    b.onclick = () => bg({ type: 'set-theme', theme: { wall: id } }); $('chips').appendChild(b);
  });
  $('tgGlow').onclick = () => bg({ type: 'set-theme', theme: { glow: !(last && last.theme && last.theme.glow) } });
  chrome.storage.local.get(['adblock', 'broker']).then((r) => { $('tgAd').classList.toggle('on', r.adblock !== false); $('broker').value = r.broker || ''; });
  $('tgAd').onclick = () => { const on = !$('tgAd').classList.contains('on'); $('tgAd').classList.toggle('on', on); chrome.storage.local.set({ adblock: on }); };
  $('broker').onchange = () => chrome.storage.local.set({ broker: $('broker').value.trim() });
  builtSwatches = true;
}

function render(s) {
  last = s;
  const t = Object.assign({}, WT_DEFAULT_THEME, s.theme || {});
  wtApplyVars(document.documentElement, t);
  if (!builtSwatches) buildSettings();
  $('sw').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.id === t.id));
  $('chips').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.id === t.wall));
  $('tgGlow').classList.toggle('on', !!t.glow);

  $('err').textContent = s.error || '';
  if (!$('name').value) $('name').value = s.name || '';
  if (!$('mname').value) $('mname').value = s.name || '';

  if (s.phase === 'connected') {
    show('room');
    $('status').textContent = s.synced ? '✨ Teleporting with ' + s.partner + ' (in sync)' : s.partner ? '💞 Connected with ' + s.partner : '⏳ Connecting…';
    const mm = s.partner && s.partnerKey && !s.synced;
    $('mismatch').classList.toggle('hide', !mm);
    if (mm) $('mtxt').textContent = s.partner + ' is on a different page';
  } else if (s.phase === 'hosting') {
    if (s.mode === 'manual') { show('mHost'); $('offer').value = s.offerCode || ''; }
    else { show('hostcode'); $('bigcode').textContent = s.roomCode ? s.roomCode.slice(0, 3) + ' ' + s.roomCode.slice(3) : '······'; }
  } else if (s.phase === 'joining') {
    if (s.mode === 'manual') { show('mJoined'); $('answer').value = s.answerCode || ''; } else show('connecting');
  } else show(localView);
}
async function copy(text, btn) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); } catch {}
  const old = btn.textContent; btn.textContent = '✅ Copied'; setTimeout(() => (btn.textContent = old), 1400);
}
const go = (v) => { localView = v; render(last); };

$('tabRoom').onclick = () => { $('paneRoom').classList.remove('hide'); $('paneSet').classList.add('hide'); $('tabRoom').classList.add('on'); $('tabSet').classList.remove('on'); };
$('tabSet').onclick = () => { $('paneSet').classList.remove('hide'); $('paneRoom').classList.add('hide'); $('tabSet').classList.add('on'); $('tabRoom').classList.remove('on'); };

$('create').onclick = () => bg({ type: 'host-code', name: name() });
$('code').addEventListener('input', () => {
  const d = digits($('code').value); $('code').value = d.length > 3 ? d.slice(0, 3) + ' ' + d.slice(3) : d;
  if (d.length === 6) bg({ type: 'join-code', name: name(), code: d });
});
$('join').onclick = () => { const d = digits($('code').value); if (d.length < 6) $('err').textContent = 'Enter the 6-digit room code'; else bg({ type: 'join-code', name: name(), code: d }); };
$('copyCode').onclick = (e) => copy(last && last.roomCode, e.target);
['cancel1', 'cancel2', 'cancel3', 'cancel4'].forEach((id) => ($(id).onclick = () => { localView = 'home'; $('reply').value = ''; $('invite').value = ''; bg({ type: 'cancel' }); }));

// manual mode
$('toManual').onclick = () => go('mHome'); $('mBack').onclick = () => go('home');
$('mCreate').onclick = () => bg({ type: 'manual-host', name: name() });
$('mGoJoin').onclick = () => go('mJoin'); $('mBack2').onclick = () => go('mHome');
$('copyOffer').onclick = (e) => copy($('offer').value, e.target);
$('copyAnswer').onclick = (e) => copy($('answer').value, e.target);
$('reply').addEventListener('input', () => { if (looksLikeCode($('reply').value)) bg({ type: 'manual-accept', code: $('reply').value }); });
$('invite').addEventListener('input', () => { if (looksLikeCode($('invite').value)) bg({ type: 'manual-join', name: name(), code: $('invite').value }); });

$('tchat').onclick = () => bg({ type: 'toggle-chat' });
$('slink').onclick = () => bg({ type: 'send-link' });
$('resync').onclick = () => bg({ type: 'resync' });
$('clear').onclick = () => bg({ type: 'clear-chat' });
$('leave').onclick = () => bg({ type: 'leave' });
$('end').onclick = () => { if (confirm('End the room for both of you?')) bg({ type: 'end' }); };
$('goto').onclick = () => { bg({ type: 'open-partner' }); window.close(); };

chrome.runtime.onMessage.addListener((m) => { if (m.type === 'state') render(m.state); });
bg({ type: 'get-state' }).then((s) => s && render(s));

// ---------- updates ----------
const openManager = (auto) => chrome.tabs.create({ url: chrome.runtime.getURL('updates.html' + (auto ? '?auto=1' : '')) });
function renderUpdate(info) {
  const cur = chrome.runtime.getManifest().version;
  const av = !!(info && info.ok && info.available);
  $('updBanner').classList.toggle('hide', !av);
  if (av) $('updBannerTxt').textContent = 'Update v' + info.latest + ' is available';
  $('updStatus').textContent = !info ? `v${cur} · not checked yet` : !info.ok ? `v${cur} · ${info.error}` : av ? `v${cur} → v${info.latest} available` : `v${cur} · up to date ✓`;
  $('updNotes').textContent = av ? (info.notes || '') : '';
  $('updOpen').textContent = av ? '⬇ Install v' + info.latest : 'Open update manager';
}
$('updBannerBtn').onclick = () => openManager(true);
$('updOpen').onclick = () => openManager(true);
$('updCheck').onclick = async () => { $('updStatus').textContent = 'Checking…'; renderUpdate(await wtCheckUpdate()); };
$('tgAuto').onclick = () => { const on = !$('tgAuto').classList.contains('on'); $('tgAuto').classList.toggle('on', on); chrome.storage.local.set({ autoUpdateCheck: on }); };
$('updUrl').onchange = () => chrome.storage.local.set({ updateUrl: $('updUrl').value.trim() });
chrome.storage.local.get(['updateInfo', 'autoUpdateCheck', 'updateUrl']).then((r) => {
  renderUpdate(r.updateInfo || null); $('tgAuto').classList.toggle('on', r.autoUpdateCheck !== false); $('updUrl').value = r.updateUrl || '';
  if (!r.updateInfo || Date.now() - r.updateInfo.checkedAt > 5 * 60 * 1000) wtCheckUpdate().then(renderUpdate);
});
chrome.storage.onChanged.addListener((c) => { if (c.updateInfo) renderUpdate(c.updateInfo.newValue); });
