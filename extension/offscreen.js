// weteleporting - offscreen document: owns the peer-to-peer (WebRTC) link.
// 6-digit codes: TWO free public matchmakers (PeerJS cloud + ntfy.sh) are used at the same time,
// either one is enough. They only introduce the two browsers; after that the link is direct.
// Manual-code mode (no matchmaker at all) is kept as a backup.
const BROKER = 'wss://0.peerjs.com/peerjs?key=peerjs';
const NTFY = 'ntfy.sh';
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }
] };
let pc = null, dc = null, role = null, locked = false, answered = false;
let transports = [];
let expireTimer = null, connTimer = null, dropTimer = null, answerTimer = null;
let pcClosing = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toBg = (m) => chrome.runtime.sendMessage({ target: 'bg', ...m }).catch(() => {});
setInterval(() => { toBg({ type: 'rtc-ping' }); if (dc && dc.readyState === 'open') dc.send('{"kind":"ping"}'); }, 20000);
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
const code6 = () => String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));

// ---------- compact code encoding (also used inside matchmaker messages) ----------
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); };
async function pipe(bytes, stream) { const w = stream.writable.getWriter(); w.write(bytes); w.close(); return new Response(stream.readable).arrayBuffer(); }
async function encode(d) { return 'WT1-' + toB64(await pipe(new TextEncoder().encode(JSON.stringify({ t: d.type, s: d.sdp })), new CompressionStream('deflate-raw'))); }
async function decode(code) {
  code = String(code || '').replace(/\s+/g, '');
  if (!code.startsWith('WT1-')) throw new Error('Not a weteleporting code');
  const o = JSON.parse(new TextDecoder().decode(await pipe(fromB64(code.slice(4)), new DecompressionStream('deflate-raw'))));
  return { type: o.t, sdp: o.s };
}

// ---------- teardown ----------
function closeTransports() { clearTimeout(expireTimer); clearTimeout(answerTimer); transports.forEach((t) => t.close()); transports = []; }
function closePc() {
  clearTimeout(connTimer); clearTimeout(dropTimer);
  pcClosing = true; try { dc && dc.close(); } catch {} try { pc && pc.close(); } catch {}
  dc = null; pc = null; setTimeout(() => (pcClosing = false), 300);
}
function resetAll() { closeTransports(); closePc(); role = null; locked = false; answered = false; }
function fail(msg) { resetAll(); toBg({ type: 'rtc-fail', error: msg }); }

// ---------- peer connection ----------
function newPc() {
  closePc();
  pc = new RTCPeerConnection(ICE); const mine = pc;
  pc.onconnectionstatechange = () => {
    if (mine !== pc) return;
    const s = pc.connectionState; clearTimeout(dropTimer);
    if (s === 'failed' || s === 'closed') { if (!pcClosing) toBg({ type: 'rtc-close' }); }
    else if (s === 'disconnected') dropTimer = setTimeout(() => { if (mine === pc && !pcClosing) toBg({ type: 'rtc-close' }); }, 12000);
  };
  return pc;
}
function wire(ch) {
  dc = ch;
  ch.onopen = () => { clearTimeout(connTimer); closeTransports(); toBg({ type: 'rtc-open' }); };
  ch.onclose = () => { if (!pcClosing && dc === ch) toBg({ type: 'rtc-close' }); };
  ch.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.kind !== 'ping') toBg({ type: 'rtc-msg', d }); } catch {} };
}
function gathered() {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, 4500);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
}
const startConnTimer = () => { clearTimeout(connTimer); connTimer = setTimeout(() => fail('Could not connect directly. Check the code, or try manual mode.'), 25000); };

// ---------- matchmaker transports ----------
// Both speak the same tiny protocol: { type: OFFER|ANSWER, src, dst, payload:{c:"WT1-..."} }
function onTState(t) {   // a transport gave up reconnecting
  if (dc || !role) return;
  if (transports.every((x) => !x.alive && x.dead)) fail('Lost contact with the matchmaking services. Create a new room, or use manual mode.');
}
function reconnecting(api, connect) {
  return async () => {
    for (let i = 1; i <= 10 && !api.closed; i++) {
      await sleep(Math.min(600 * i, 4000));
      if (api.closed) return;
      try { await connect(); return; } catch {}
    }
    if (!api.closed) { api.dead = true; onTState(api); }
  };
}

function makePeerJS(id, broker, onMsg) {
  const token = rand(12);   // stable token so we can re-register the same id after a drop
  let ws = null, hb = null;
  const api = { name: 'peerjs', id, alive: false, dead: false, closed: false,
    send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; },
    close() { api.closed = true; clearInterval(hb); try { ws && ws.close(); } catch {} } };
  const connect = () => new Promise((resolve, reject) => {
    const base = broker || BROKER; let w, ok = false;
    try { w = new WebSocket(`${base}${base.includes('?') ? '&' : '?'}id=${id}&token=${token}`); } catch (e) { return reject(e); }
    const t = setTimeout(() => { try { w.close(); } catch {} reject(new Error('timeout')); }, 6000);
    w.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'OPEN' && !ok) {
        ok = true; clearTimeout(t); ws = w; api.alive = true; clearInterval(hb);
        hb = setInterval(() => api.send({ type: 'HEARTBEAT' }), 5000); resolve();
      } else if (m.type === 'ID-TAKEN') { clearTimeout(t); try { w.close(); } catch {} reject(Object.assign(new Error('taken'), { taken: true }));
      } else if (m.type === 'ERROR' || m.type === 'INVALID-KEY') { clearTimeout(t); try { w.close(); } catch {} reject(new Error('refused'));
      } else if (ok) onMsg(m, api);
    };
    w.onclose = () => {
      clearTimeout(t);
      if (!ok) return reject(new Error('closed'));
      if (ws === w) { ws = null; api.alive = false; clearInterval(hb); if (!api.closed) reconnecting(api, connect)(); }
    };
    w.onerror = () => {};
  });
  api.start = connect;
  return api;
}

function makeNtfy(topic, id, onMsg) {
  let ws = null;
  const api = { name: 'ntfy', id, alive: false, dead: false, closed: false,
    send(o) { fetch(`https://${NTFY}/${topic}`, { method: 'POST', body: JSON.stringify({ ...o, src: id }) }).catch(() => {}); return true; },
    close() { api.closed = true; try { ws && ws.close(); } catch {} } };
  const connect = () => new Promise((resolve, reject) => {
    let w, ok = false;
    try { w = new WebSocket(`wss://${NTFY}/${topic}/ws`); } catch (e) { return reject(e); }
    const t = setTimeout(() => { try { w.close(); } catch {} reject(new Error('timeout')); }, 6000);
    w.onopen = () => { ok = true; clearTimeout(t); ws = w; api.alive = true; resolve(); };
    w.onmessage = (e) => {
      let ev; try { ev = JSON.parse(e.data); } catch { return; }
      if (ev.event !== 'message') return;
      let m; try { m = JSON.parse(ev.message); } catch { return; }
      if (m && m.src !== id && (!m.dst || m.dst === id)) onMsg(m, api);
    };
    w.onclose = () => {
      clearTimeout(t);
      if (!ok) return reject(new Error('closed'));
      if (ws === w) { ws = null; api.alive = false; if (!api.closed) reconnecting(api, connect)(); }
    };
    w.onerror = () => {};
  });
  api.start = connect;
  return api;
}

async function onSigMsg(m, api) {
  try {
    if (role === 'host' && m.type === 'OFFER' && !locked && m.payload && m.payload.c) {
      locked = true; clearTimeout(expireTimer);
      const offer = await decode(m.payload.c);
      newPc(); pc.ondatachannel = (e) => wire(e.channel);
      await pc.setRemoteDescription(offer);
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered();
      api.send({ type: 'ANSWER', dst: m.src, payload: { c: await encode(pc.localDescription) } });
      startConnTimer();
    } else if (role === 'guest' && m.type === 'ANSWER' && !answered && m.payload && m.payload.c) {
      answered = true; clearTimeout(answerTimer);
      await pc.setRemoteDescription(await decode(m.payload.c));
      startConnTimer();
    }
  } catch (e) { fail('Connection error: ' + e.message); }
}

// ---------- commands ----------
const cmds = {
  async 'host-start'({ broker }) {
    resetAll();
    for (let i = 0; i < 6; i++) {
      const code = code6();
      const pj = makePeerJS('wt1-' + code, broker, onSigMsg);
      const nt = makeNtfy('wtport-' + code, 'host', onSigMsg);
      const [a, b] = await Promise.allSettled([pj.start(), nt.start()]);
      if (a.status === 'rejected' && a.reason && a.reason.taken) { pj.close(); nt.close(); continue; }
      const list = [];
      if (a.status === 'fulfilled') list.push(pj); else pj.close();
      if (b.status === 'fulfilled') list.push(nt); else nt.close();
      if (!list.length) throw new Error('Could not reach any matchmaking service. Check your internet, or use manual mode.');
      transports = list; role = 'host'; locked = false;
      expireTimer = setTimeout(() => fail('The room code expired. Create a new room.'), 10 * 60 * 1000);
      return { code };
    }
    throw new Error('Could not get a free room code, try again');
  },
  async 'join-start'({ code, broker }) {
    resetAll(); role = 'guest'; answered = false;
    code = String(code).trim();
    newPc(); wire(pc.createDataChannel('wt'));
    const offerCode = (async () => { await pc.setLocalDescription(await pc.createOffer()); await gathered(); return encode(pc.localDescription); })();
    const pj = makePeerJS('wtg-' + rand(10), broker, onSigMsg);
    const nt = makeNtfy('wtport-' + code, 'g' + rand(8), onSigMsg);
    const [a, b] = await Promise.allSettled([pj.start(), nt.start()]);
    const list = [];
    if (a.status === 'fulfilled') list.push(pj); else pj.close();
    if (b.status === 'fulfilled') list.push(nt); else nt.close();
    if (!list.length) { resetAll(); throw new Error('Could not reach any matchmaking service. Check your internet, or use manual mode.'); }
    transports = list;
    const c = await offerCode;
    for (const t of list) t.send({ type: 'OFFER', dst: t.name === 'peerjs' ? 'wt1-' + code : 'host', payload: { c } });
    answerTimer = setTimeout(() => { if (!answered) fail('Room not found. Check the 6-digit code, and make sure your partner is still waiting on the "Room code" screen.'); }, 20000);
    return {};
  },
  // manual mode (no matchmaker)
  async create() {
    resetAll(); newPc(); wire(pc.createDataChannel('wt'));
    await pc.setLocalDescription(await pc.createOffer()); await gathered();
    return { code: await encode(pc.localDescription) };
  },
  async 'accept-offer'({ code }) {
    resetAll(); const offer = await decode(code);
    if (offer.type !== 'offer') throw new Error('That is not an invite code');
    newPc(); pc.ondatachannel = (e) => wire(e.channel);
    await pc.setRemoteDescription(offer); await pc.setLocalDescription(await pc.createAnswer()); await gathered();
    return { code: await encode(pc.localDescription) };
  },
  async 'accept-answer'({ code }) {
    if (!pc) throw new Error('No room is waiting');
    const ans = await decode(code);
    if (ans.type !== 'answer') throw new Error('That is not a reply code');
    await pc.setRemoteDescription(ans); return {};
  },
  async send({ d }) { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(d)); return {}; },
  async status() { return { open: !!dc && dc.readyState === 'open' }; },
  async close() { resetAll(); return {}; }
};
chrome.runtime.onMessage.addListener((m, s, respond) => {
  if (m.target !== 'offscreen' || !cmds[m.cmd]) return;
  cmds[m.cmd](m).then((r) => respond({ ok: true, ...r })).catch((e) => respond({ ok: false, error: e.message }));
  return true;
});
