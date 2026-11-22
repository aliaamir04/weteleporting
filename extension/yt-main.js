// weteleporting - YouTube: strip ad data from player responses before the player sees it.
(() => {
  const off = () => document.documentElement.dataset.wtAdblock === 'off';
  const KEYS = ['adPlacements', 'playerAds', 'adSlots'];
  function clean(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 3 || off()) return;
    for (const k of KEYS) if (k in o) { try { delete o[k]; } catch {} }
    if (o.playerResponse) clean(o.playerResponse, depth + 1);
    if (o.response) clean(o.response, depth + 1);
    if (Array.isArray(o)) o.forEach((x) => clean(x, depth + 1));
  }
  const jp = JSON.parse;
  JSON.parse = function () { const r = jp.apply(this, arguments); try { clean(r); } catch {} return r; };
  const rj = Response.prototype.json;
  Response.prototype.json = async function () { const r = await rj.apply(this, arguments); try { clean(r); } catch {} return r; };
  try {
    let v;
    Object.defineProperty(window, 'ytInitialPlayerResponse', { configurable: true, get() { return v; }, set(x) { try { clean(x); } catch {} v = x; } });
  } catch {}
})();
