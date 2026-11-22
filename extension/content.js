// weteleporting - content script: video sync (all frames) + chat UI (top frame)
(() => {
  if (window.__wtp) return; window.__wtp = true;
  const TOP = window.top === window;
  let ST = null, remoteUntil = 0, pendingApply = null, pendingTimer = null;
  const bg = (m) => { try { return chrome.runtime.sendMessage(m).catch(() => {}); } catch { return Promise.resolve(); } };

  // ================= VIDEO SYNC =================
  const isAd = () => !!document.querySelector('.html5-video-player.ad-showing');
  const score = (v) => { const r = v.getBoundingClientRect(); return (v.paused ? 0 : 1e8) + r.width * r.height; };
  function mainVideo() {
    const vs = [...document.querySelectorAll('video')].filter((v) => v.readyState > 0 || v.currentSrc || v.src);
    return vs.length ? vs.sort((a, b) => score(b) - score(a))[0] : null;
  }
  function report(v, reason) {
    if (isAd()) return;
    bg({ type: 'sync', d: { playing: !v.paused, time: v.currentTime, rate: v.playbackRate, reason, ts: Date.now() } });
  }
  ['play', 'pause', 'seeked', 'ratechange'].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      if (!(e.target instanceof HTMLVideoElement)) return;
      if (!ST || !ST.synced || Date.now() < remoteUntil || e.target !== mainVideo()) return;
      report(e.target, ev);
    }, true));

  function apply(d) {
    if (isAd()) {   // wait until our own ad is gone, then catch up
      pendingApply = d; clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => { const x = pendingApply; pendingApply = null; if (x) apply(x); }, 1000);
      return;
    }
    const v = mainVideo(); if (!v || !ST || !ST.synced) return;
    const t = d.time + (d.playing ? 0.12 : 0), thr = d.reason === 'beat' ? 0.8 : 0.3;
    let changed = false;
    if (Math.abs(v.currentTime - t) > thr) { v.currentTime = t; changed = true; }
    if (Math.abs(v.playbackRate - d.rate) > 0.01) { v.playbackRate = d.rate; changed = true; }
    if (d.playing && v.paused) {
      changed = true; remoteUntil = Date.now() + 800;
      v.play().catch(() => bg({ type: 'toast', text: '▶ Click anywhere on the page so the video can start for you two 💞' }));
    } else if (!d.playing && !v.paused) { changed = true; v.pause(); }
    if (changed) remoteUntil = Math.max(remoteUntil, Date.now() + 800);
  }
  setInterval(() => {   // host heartbeat: the other side corrects drift
    const v = mainVideo();
    if (v && ST && ST.synced && ST.host && !v.paused && !document.hidden) report(v, 'beat');
  }, 3000);

  // ================= CHAT UI (top frame only) =================
  let host, root, els = {}, unread = 0, lastCount = 0, typingTimer = null, lastTypingSent = 0, appliedKey = '';
  const EMOJIS = ['❤️','😘','🥰','😍','😂','😭','🔥','✨','🌹','💋','🍿','🎬','😴','🥺','👏','🫶','💞','😏','🙈','🤭','💕','😋','🫠','🌙'];
  const REACTS = ['❤️', '😂', '😮', '🔥', '😭'];
  const SEND_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  const CSS = `
  :host{all:initial}
  *{box-sizing:border-box;font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
  .hide{display:none!important}
  .glow{position:fixed;inset:0;pointer-events:none;z-index:2147483645;box-shadow:inset 0 0 90px 10px var(--glow);animation:gl 5s ease-in-out infinite}
  @keyframes gl{0%,100%{opacity:.55}50%{opacity:1}}
  .wrap{position:fixed;right:20px;bottom:20px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;gap:12px;color:var(--fg)}
  .fab{width:54px;height:54px;border-radius:50%;border:0;cursor:pointer;color:#fff;position:relative;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,var(--a),var(--b));box-shadow:0 10px 28px rgba(0,0,0,.35),0 0 0 1px rgba(255,255,255,.15) inset;transition:transform .2s}
  .fab:hover{transform:scale(1.08)} .fab.beat{animation:beat 1.8s infinite}
  .fab svg{width:24px;height:24px;fill:#fff}
  @keyframes beat{0%,100%{transform:scale(1)}15%{transform:scale(1.1)}30%{transform:scale(1)}45%{transform:scale(1.06)}}
  .badge{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;border-radius:10px;background:#fff;color:#c2185b;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 5px}
  .panel{width:344px;height:490px;max-height:82vh;display:flex;flex-direction:column;border-radius:24px;overflow:hidden;position:relative;
    background:rgba(var(--bg),.92);backdrop-filter:blur(24px) saturate(1.4);-webkit-backdrop-filter:blur(24px) saturate(1.4);
    border:1px solid var(--line);box-shadow:0 28px 70px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.07);animation:pop .28s cubic-bezier(.2,.9,.3,1.2);transform-origin:bottom right}
  @keyframes pop{from{opacity:0;transform:scale(.88) translateY(10px)}to{opacity:1;transform:none}}
  .head{display:flex;align-items:center;gap:11px;padding:13px 14px;border-bottom:1px solid var(--line);cursor:grab;user-select:none;touch-action:none}
  .head:active{cursor:grabbing}
  .av{width:38px;height:38px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#fff;position:relative;background:linear-gradient(135deg,var(--a),var(--b))}
  .dot{position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:#8a8a8a;border:2px solid rgb(var(--bg))}
  .dot.on{background:#4ade80}.dot.sync{background:var(--a);box-shadow:0 0 8px var(--a)}
  .ttl{flex:1;min-width:0}.ttl b{display:block;font-size:14.5px;font-weight:650;letter-spacing:.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ttl small{display:block;font-size:11.5px;color:var(--dim);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ib{background:transparent;border:0;color:var(--dim);border-radius:10px;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
  .ib:hover{background:var(--pb);color:var(--fg)} .ib svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
  .banner{padding:8px 14px;font-size:12px;background:rgba(255,190,70,.14);color:#f6c667;display:flex;gap:8px;align-items:center;justify-content:space-between}
  .banner span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .banner button{border:0;border-radius:9px;padding:5px 10px;background:#f6c667;color:#3f2a00;font-weight:650;cursor:pointer;font-size:11px;white-space:nowrap}
  .body{flex:1;position:relative;min-height:0;display:flex;flex-direction:column}
  .msgs{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:3px;background-position:center}
  .msgs::-webkit-scrollbar{width:5px}.msgs::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
  .m{max-width:80%;padding:8px 13px;border-radius:18px;font-size:14px;line-height:1.38;word-wrap:break-word;white-space:pre-wrap;animation:in .2s ease-out}
  @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  .m.me{align-self:flex-end;color:#fff;background:linear-gradient(135deg,var(--a),var(--b));border-bottom-right-radius:6px;box-shadow:0 3px 10px rgba(0,0,0,.18)}
  .m.partner{align-self:flex-start;background:var(--pb);border-bottom-left-radius:6px}
  .m.cont.me{border-top-right-radius:6px}.m.cont.partner{border-top-left-radius:6px}
  .m.sys{align-self:center;max-width:94%;background:none;font-size:11.5px;color:var(--dim);text-align:center;padding:6px 4px}
  .m.big{font-size:32px;padding:2px 6px;background:none;box-shadow:none}
  .m button{display:block;margin-top:7px;border:0;border-radius:10px;padding:6px 12px;background:rgba(255,255,255,.95);color:#b0245f;font-weight:650;cursor:pointer;font-size:12.5px}
  .tm{font-size:10px;color:var(--dim);margin:1px 6px 7px;opacity:.8}.tm.me{align-self:flex-end}.tm.partner{align-self:flex-start}
  .gap{margin-top:7px}
  .typing{display:flex;gap:4px;padding:10px 14px;margin:0 14px 4px;width:fit-content;background:var(--pb);border-radius:16px;border-bottom-left-radius:5px}
  .typing i{width:6px;height:6px;border-radius:50%;background:var(--dim);animation:tp2 1.2s infinite}.typing i:nth-child(2){animation-delay:.18s}.typing i:nth-child(3){animation-delay:.36s}
  @keyframes tp2{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
  .react{display:flex;gap:6px;padding:6px 14px 0}
  .react button{flex:1;border:0;border-radius:12px;background:var(--pb);font-size:16px;padding:4px 0;cursor:pointer;transition:.12s}
  .react button:hover{transform:translateY(-2px) scale(1.1);background:var(--inp)}
  .tray{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:8px;background:var(--inp);margin:7px 14px 0;border-radius:14px}
  .tray button{background:none;border:0;font-size:19px;cursor:pointer;border-radius:8px;padding:3px 0}.tray button:hover{background:var(--pb)}
  .inp{display:flex;gap:8px;padding:10px 12px 13px;align-items:center}
  .field{flex:1;min-width:0;display:flex;align-items:center;background:var(--inp);border:1px solid var(--line);border-radius:24px;padding:0 6px 0 4px;transition:.15s}
  .field:focus-within{border-color:var(--a);box-shadow:0 0 0 3px rgba(255,255,255,.04)}
  .field input{flex:1;min-width:0;border:0;background:transparent;color:var(--fg);padding:10px 6px;font-size:14px;outline:none}
  .field input::placeholder{color:var(--dim)}
  .emo{background:none;border:0;font-size:20px;cursor:pointer;padding:4px 6px;border-radius:50%}
  .send{width:40px;height:40px;border-radius:50%;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--a),var(--b));box-shadow:0 6px 16px rgba(0,0,0,.25);transition:.15s}
  .send:hover{transform:scale(1.07)}
  .drawer{position:absolute;inset:0;background:rgba(var(--bg),.97);padding:16px 16px 12px;overflow:auto;z-index:5;animation:in .2s}
  .drawer h4{margin:0 0 4px;font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:var(--dim);font-weight:650}
  .drawer .note{font-size:11.5px;color:var(--dim);margin:0 0 14px}
  .sw{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0 18px}
  .sw button{border:0;cursor:pointer;background:none;color:var(--dim);font-size:10.5px;display:flex;flex-direction:column;align-items:center;gap:5px;padding:0}
  .sw i{width:38px;height:38px;border-radius:50%;display:block;border:2px solid transparent;box-shadow:0 0 0 2px transparent;transition:.15s}
  .sw button.sel i{box-shadow:0 0 0 2px var(--fg)}.sw button.sel{color:var(--fg)}
  .chips{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 18px}
  .chips button{border:1px solid var(--line);background:transparent;color:var(--dim);border-radius:18px;padding:6px 13px;font-size:12.5px;cursor:pointer}
  .chips button.sel{background:linear-gradient(135deg,var(--a),var(--b));color:#fff;border-color:transparent}
  .row{display:flex;align-items:center;justify-content:space-between;font-size:13.5px;margin-bottom:16px}
  .tg{width:42px;height:24px;border-radius:12px;border:0;background:var(--pb);position:relative;cursor:pointer;transition:.2s}
  .tg::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s}
  .tg.on{background:linear-gradient(135deg,var(--a),var(--b))}.tg.on::after{left:21px}
  .done{width:100%;border:0;border-radius:14px;padding:10px;color:#fff;font-weight:650;cursor:pointer;background:linear-gradient(135deg,var(--a),var(--b))}
  .toast{position:fixed;left:50%;top:22px;transform:translateX(-50%);z-index:2147483647;padding:10px 20px;border-radius:26px;color:#fff;font-size:13.5px;font-weight:550;background:linear-gradient(135deg,var(--a),var(--b));box-shadow:0 10px 34px rgba(0,0,0,.4);animation:drop .35s}
  @keyframes drop{from{opacity:0;transform:translate(-50%,-20px)}to{opacity:1;transform:translate(-50%,0)}}
  .float{position:fixed;bottom:90px;font-size:38px;pointer-events:none;z-index:2147483647;animation:up 2.4s ease-out forwards}
  @keyframes up{0%{opacity:0;transform:translateY(0) scale(.5)}15%{opacity:1}100%{opacity:0;transform:translateY(-55vh) scale(1.4) rotate(12deg)}}
  .tpf{position:fixed;inset:0;pointer-events:none;z-index:2147483646;background:radial-gradient(circle,var(--glow),transparent 60%);animation:tpa 1.4s ease-out forwards}
  @keyframes tpa{0%{opacity:0;transform:scale(.4)}30%{opacity:1}100%{opacity:0;transform:scale(1.6)}}`;

  const ic = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const ICONS = {
    gear: ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    link: ic('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.700 1.700"/><path d="M14 11a5 5 0 0 0-7.500-.5l-3 3a5 5 0 0 0 7 7l1.700-1.700"/>'),
    min: ic('<path d="M5 12h14"/>'),
    heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-7.500-4.600-9.600-9.300C1 8.400 2.700 5 6 5c2 0 3.300 1 4 2.300h4C14.700 6 16 5 18 5c3.300 0 5 3.400 3.600 6.700C19.500 16.400 12 21 12 21z"/></svg>'
  };

  function buildUI() {
    host = document.createElement('div'); host.id = 'weteleporting-host';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
    <div class="glow hide" id="glow"></div>
    <div class="wrap" id="wrap">
      <div class="panel hide" id="panel">
        <div class="head" id="head">
          <div class="av" id="av">♥<span class="dot" id="dot"></span></div>
          <div class="ttl"><b id="who"></b><small id="sub"></small></div>
          <button class="ib" id="gear" title="Look & feel (shared with your partner)">${ICONS.gear}</button>
          <button class="ib" id="link" title="Send this page to your partner">${ICONS.link}</button>
          <button class="ib" id="min" title="Hide chat (Alt+Shift+C)">${ICONS.min}</button>
        </div>
        <div class="banner hide" id="banner"><span id="btxt"></span><button id="bgo">Go there</button></div>
        <div class="body">
          <div class="msgs" id="msgs"></div>
          <div class="typing hide" id="typing"><i></i><i></i><i></i></div>
          <div class="drawer hide" id="drawer">
            <h4>Look &amp; feel</h4><p class="note">Shared: when one of you changes it, it changes for both 💞</p>
            <h4>Theme</h4><div class="sw" id="sw"></div>
            <h4>Chat background</h4><div class="chips" id="chips"></div>
            <div class="row"><span>Soft glow around the screen</span><button class="tg" id="tgGlow"></button></div>
            <button class="done" id="done">Done</button>
          </div>
        </div>
        <div class="react" id="react"></div>
        <div class="tray hide" id="tray"></div>
        <div class="inp">
          <div class="field"><button class="emo" id="emo">😊</button><input id="txt" maxlength="1000" placeholder="Say something sweet…" autocomplete="off"></div>
          <button class="send" id="snd">${SEND_SVG}</button>
        </div>
      </div>
      <button class="fab hide" id="fab" title="Open chat">${ICONS.heart}<span class="badge" id="badge"></span></button>
    </div>`;
    const $ = (id) => root.getElementById(id);
    ['glow','wrap','panel','head','av','dot','who','sub','gear','link','min','banner','btxt','bgo','msgs','typing','drawer','sw','chips','tgGlow','done','react','tray','emo','txt','snd','fab','badge']
      .forEach((i) => (els[i] = $(i)));

    EMOJIS.forEach((e) => { const b = document.createElement('button'); b.textContent = e; b.onclick = () => { els.txt.value += e; els.txt.focus(); }; els.tray.appendChild(b); });
    REACTS.forEach((e) => { const b = document.createElement('button'); b.textContent = e; b.onclick = () => { bg({ type: 'react', emoji: e }); floatEmoji(e); }; els.react.appendChild(b); });
    Object.keys(WT_THEMES).forEach((id) => {
      const th = WT_THEMES[id], b = document.createElement('button'); b.dataset.id = id;
      b.innerHTML = `<i style="background:linear-gradient(135deg,${th.a},${th.b})"></i>${th.name}`;
      b.onclick = () => bg({ type: 'set-theme', theme: { id } }); els.sw.appendChild(b);
    });
    Object.keys(WT_WALLS).forEach((id) => {
      const b = document.createElement('button'); b.dataset.id = id; b.textContent = WT_WALLS[id];
      b.onclick = () => bg({ type: 'set-theme', theme: { wall: id } }); els.chips.appendChild(b);
    });
    els.tgGlow.onclick = () => bg({ type: 'set-theme', theme: { glow: !(ST && ST.theme && ST.theme.glow) } });
    els.gear.onclick = () => els.drawer.classList.toggle('hide');
    els.done.onclick = () => els.drawer.classList.add('hide');

    const sendMsg = () => { const t = els.txt.value.trim(); if (!t) return; bg({ type: 'chat', text: t }); els.txt.value = ''; };
    els.snd.onclick = sendMsg;
    ['keydown', 'keyup', 'keypress'].forEach((k) => els.txt.addEventListener(k, (e) => { e.stopPropagation(); if (k === 'keydown' && e.key === 'Enter') sendMsg(); }));
    els.txt.addEventListener('input', () => { if (Date.now() - lastTypingSent > 2000) { lastTypingSent = Date.now(); bg({ type: 'typing' }); } });
    els.emo.onclick = () => els.tray.classList.toggle('hide');
    els.min.onclick = () => bg({ type: 'toggle-chat', value: true });
    els.fab.onclick = () => bg({ type: 'toggle-chat', value: false });
    els.link.onclick = () => bg({ type: 'send-link' });
    els.bgo.onclick = () => bg({ type: 'open-partner' });

    // drag by header; stays anchored to its bottom-right corner
    let drag = null;
    els.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = els.wrap.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; els.head.setPointerCapture(e.pointerId);
    });
    els.head.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const w = els.wrap, x = Math.min(Math.max(e.clientX - drag.dx, 0), innerWidth - w.offsetWidth), y = Math.min(Math.max(e.clientY - drag.dy, 0), innerHeight - w.offsetHeight);
      w.style.right = innerWidth - (x + w.offsetWidth) + 'px'; w.style.bottom = innerHeight - (y + w.offsetHeight) + 'px';
    });
    els.head.addEventListener('pointerup', () => {
      if (!drag) return; drag = null;
      try { chrome.storage.local.set({ chatPos: { right: parseFloat(els.wrap.style.right), bottom: parseFloat(els.wrap.style.bottom) } }); } catch {}
    });
    try {
      chrome.storage.local.get('chatPos').then((r) => {
        if (r.chatPos) { els.wrap.style.right = Math.min(Math.max(r.chatPos.right, 0), innerWidth - 80) + 'px'; els.wrap.style.bottom = Math.min(Math.max(r.chatPos.bottom, 0), innerHeight - 80) + 'px'; }
      });
    } catch {}
    placeHost();
  }
  function placeHost() {
    const fs = document.fullscreenElement;
    const target = fs && !(fs instanceof HTMLVideoElement) ? fs : document.documentElement;
    if (host && host.parentNode !== target) target.appendChild(host);
  }
  document.addEventListener('fullscreenchange', () => TOP && host && placeHost());

  function applyTheme() {
    const t = Object.assign({}, WT_DEFAULT_THEME, ST.theme || {}), key = JSON.stringify(t);
    if (key === appliedKey) return; appliedKey = key;
    wtApplyVars(host, t);
    host.style.setProperty('--glow', wtHexA(wtTheme(t).a, .38));
    els.msgs.style.backgroundImage = wtWall(t);
    els.msgs.style.backgroundSize = t.wall === 'aurora' ? 'cover' : '';
    els.glow.classList.toggle('hide', !t.glow);
    els.tgGlow.classList.toggle('on', !!t.glow);
    els.sw.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.id === t.id));
    els.chips.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.id === t.wall));
  }

  const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  function render() {
    const inRoom = !!(ST && ST.phase === 'connected');
    if (!inRoom) { if (host) { els.panel.classList.add('hide'); els.fab.classList.add('hide'); els.glow.classList.add('hide'); } lastCount = 0; unread = 0; return; }
    if (!host) buildUI();
    host.style.display = ''; placeHost(); applyTheme();

    els.panel.classList.toggle('hide', ST.chatHidden);
    els.fab.classList.toggle('hide', !ST.chatHidden);
    els.fab.classList.toggle('beat', !!ST.synced);
    els.dot.className = 'dot' + (ST.synced ? ' sync' : ST.partner ? ' on' : '');
    els.av.firstChild.textContent = (ST.partner || '♥').trim().charAt(0).toUpperCase() || '♥';
    els.who.textContent = ST.partner ? ST.partner : 'Connecting…';
    els.sub.textContent = ST.synced ? '✨ in sync · teleporting' : ST.partner ? 'connected · not on the same page' : 'connecting…';

    const mismatch = ST.partner && ST.partnerKey && !ST.synced;
    els.banner.classList.toggle('hide', !mismatch);
    if (mismatch) els.btxt.textContent = `${ST.partner} is on: ${(ST.partnerTitle || ST.partnerUrl || '').slice(0, 44)}`;

    const atBottom = els.msgs.scrollTop + els.msgs.clientHeight > els.msgs.scrollHeight - 50;
    els.msgs.innerHTML = '';
    const list = ST.chat;
    list.forEach((m, i) => {
      const prev = list[i - 1], next = list[i + 1];
      const sameAsPrev = prev && prev.from === m.from && m.from !== 'sys' && m.ts - prev.ts < 120000;
      const sameAsNext = next && next.from === m.from && m.from !== 'sys' && next.ts - m.ts < 120000;
      const onlyEmoji = !m.link && m.from !== 'sys' && /^(\p{Extended_Pictographic}|\u200d|\ufe0f|\s){1,6}$/u.test(m.text);
      const d = document.createElement('div');
      d.className = 'm ' + m.from + (sameAsPrev ? ' cont' : (i ? ' gap' : '')) + (onlyEmoji ? ' big' : '');
      d.appendChild(document.createTextNode(m.text));
      if (m.link && m.url) { const b = document.createElement('button'); b.textContent = '✨ Open this together'; b.onclick = () => bg({ type: 'open-url', url: m.url }); d.appendChild(b); }
      els.msgs.appendChild(d);
      if (m.from !== 'sys' && !sameAsNext) { const t = document.createElement('div'); t.className = 'tm ' + m.from; t.textContent = fmt(m.ts); els.msgs.appendChild(t); }
    });
    if (atBottom || list.length !== lastCount) els.msgs.scrollTop = els.msgs.scrollHeight;

    const last = list[list.length - 1];
    if (list.length > lastCount && last && last.from === 'partner' && ST.chatHidden) { unread++; toast(`💬 ${last.name || ''}: ${last.text.slice(0, 60)}`, 3000); }
    if (!ST.chatHidden) unread = 0;
    els.badge.style.display = unread ? 'flex' : 'none'; els.badge.textContent = unread;
    if (last && last.from === 'partner') els.typing.classList.add('hide');
    lastCount = list.length;
  }

  function toast(text, ms = 3500) {
    if (!TOP) return; if (!host) buildUI(); wtApplyVars(host, (ST && ST.theme) || WT_DEFAULT_THEME);
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = text; root.appendChild(t); setTimeout(() => t.remove(), ms);
  }
  function floatEmoji(e) {
    if (!TOP || !host) return;
    const f = document.createElement('div'); f.className = 'float'; f.textContent = e; f.style.right = 40 + Math.random() * 120 + 'px';
    root.appendChild(f); setTimeout(() => f.remove(), 2500);
  }

  let wasSynced = false;
  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'state') {
      ST = m.state;
      if (TOP) {
        render();
        if (ST.synced && !wasSynced && host) { const f = document.createElement('div'); f.className = 'tpf'; root.appendChild(f); setTimeout(() => f.remove(), 1500); toast('✨ Teleport started. You are in sync!'); }
        wasSynced = !!ST.synced;
      }
    } else if (m.type === 'apply') apply(m.d);
    else if (m.type === 'push') { const v = mainVideo(); if (v) report(v, 'push'); }
    else if (m.type === 'toast') toast(m.text);
    else if (m.type === 'typing') { if (host && els.typing) { els.typing.classList.remove('hide'); els.msgs.scrollTop = els.msgs.scrollHeight; clearTimeout(typingTimer); typingTimer = setTimeout(() => els.typing.classList.add('hide'), 3000); } }
    else if (m.type === 'react') for (let i = 0; i < 3; i++) setTimeout(() => floatEmoji(m.emoji), i * 180);
  });
  bg({ type: 'get-state' }).then((s) => { if (s && s.phase) { ST = s; wasSynced = !!s.synced; TOP && render(); } });
})();
