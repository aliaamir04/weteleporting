// weteleporting - shared theme data
const WT_THEMES = {
  rose:     { name: 'Rose',     a: '#ff6b9d', b: '#c44fd8', bg: '30,14,36',   fg: '#ffffff', pb: 'rgba(255,255,255,.11)', inp: 'rgba(255,255,255,.09)', dim: 'rgba(255,255,255,.6)',  line: 'rgba(255,150,200,.22)' },
  midnight: { name: 'Midnight', a: '#6ea8ff', b: '#7c5cff', bg: '11,15,34',   fg: '#ffffff', pb: 'rgba(255,255,255,.1)',  inp: 'rgba(255,255,255,.08)', dim: 'rgba(255,255,255,.6)',  line: 'rgba(130,160,255,.22)' },
  sunset:   { name: 'Sunset',   a: '#ff9a5c', b: '#ff4d8d', bg: '36,16,18',   fg: '#ffffff', pb: 'rgba(255,255,255,.11)', inp: 'rgba(255,255,255,.09)', dim: 'rgba(255,255,255,.62)', line: 'rgba(255,160,110,.24)' },
  ocean:    { name: 'Ocean',    a: '#2dd4bf', b: '#38bdf8', bg: '7,26,34',    fg: '#ffffff', pb: 'rgba(255,255,255,.1)',  inp: 'rgba(255,255,255,.08)', dim: 'rgba(255,255,255,.6)',  line: 'rgba(80,220,220,.22)' },
  forest:   { name: 'Forest',   a: '#7bd88f', b: '#2fa36b', bg: '10,28,20',   fg: '#ffffff', pb: 'rgba(255,255,255,.1)',  inp: 'rgba(255,255,255,.08)', dim: 'rgba(255,255,255,.6)',  line: 'rgba(120,220,150,.22)' },
  lavender: { name: 'Lavender', a: '#b79cff', b: '#ff9ed8', bg: '27,21,42',   fg: '#ffffff', pb: 'rgba(255,255,255,.11)', inp: 'rgba(255,255,255,.09)', dim: 'rgba(255,255,255,.62)', line: 'rgba(190,160,255,.24)' },
  gold:     { name: 'Gold',     a: '#e8c07a', b: '#b8863b', bg: '20,18,16',   fg: '#fff8ec', pb: 'rgba(255,240,210,.1)',  inp: 'rgba(255,240,210,.08)', dim: 'rgba(255,240,210,.6)',  line: 'rgba(232,192,122,.26)' },
  ivory:    { name: 'Ivory',    a: '#e0457b', b: '#a855f7', bg: '255,250,251', fg: '#3b2230', pb: 'rgba(60,20,40,.07)',    inp: 'rgba(60,20,40,.06)',    dim: 'rgba(59,34,48,.58)',    line: 'rgba(224,69,123,.25)' }
};
const WT_WALLS = { none: 'Plain', hearts: 'Hearts', stars: 'Stars', dots: 'Dots', lines: 'Lines', aurora: 'Aurora' };
const WT_DEFAULT_THEME = { id: 'rose', wall: 'hearts', glow: false };

function wtTheme(t) { return WT_THEMES[t && t.id] || WT_THEMES.rose; }
function wtHexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
function wtApplyVars(el, t) {
  const th = wtTheme(t);
  const v = { '--a': th.a, '--b': th.b, '--bg': th.bg, '--fg': th.fg, '--pb': th.pb, '--inp': th.inp, '--dim': th.dim, '--line': th.line };
  for (const k in v) el.style.setProperty(k, v[k]);
}
function wtWall(t) {
  const th = wtTheme(t), id = (t && t.wall) || 'none', a = th.a;
  const svg = (w, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${w}'>${body}</svg>`)}")`;
  switch (id) {
    case 'hearts': return svg(64, `<g fill='${a}' fill-opacity='.13'><path d='M16 27C5 19 4 11 10 8c3-1.500 6 0 6 3 0-3 3-4.500 6-3 6 3 5 11-6 19z'/><path transform='translate(36 34) scale(.7)' d='M16 27C5 19 4 11 10 8c3-1.500 6 0 6 3 0-3 3-4.500 6-3 6 3 5 11-6 19z'/></g>`);
    case 'stars': return svg(60, `<g fill='${a}' fill-opacity='.18'><polygon points='14,4 16,12 24,14 16,16 14,24 12,16 4,14 12,12'/><circle cx='44' cy='40' r='1.600'/><circle cx='50' cy='12' r='1.100'/><circle cx='20' cy='46' r='1.200'/></g>`);
    case 'dots': return svg(24, `<circle cx='12' cy='12' r='1.600' fill='${a}' fill-opacity='.2'/>`);
    case 'lines': return svg(28, `<path d='M-2 30L30 -2' stroke='${a}' stroke-opacity='.14' stroke-width='1.500'/>`);
    case 'aurora': return `radial-gradient(circle at 12% 8%, ${wtHexA(a, .32)}, transparent 55%), radial-gradient(circle at 92% 92%, ${wtHexA(th.b, .3)}, transparent 55%)`;
    default: return 'none';
  }
}
