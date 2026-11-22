// weteleporting - ad blocker (page cleanup + YouTube ad skipper). Network blocking is in rules.json.
(() => {
  const H = location.hostname;
  const YT = /(^|\.)youtube(-nocookie)?\.com$/.test(H);
  let on = true;

  const GENERIC = ['.adsbygoogle', 'ins.adsbygoogle', 'iframe[src*="doubleclick.net"]', 'iframe[src*="googlesyndication.com"]',
    '[id^="google_ads_iframe"]', '[id^="div-gpt-ad"]', '[aria-label="Advertisement"]', '.ad-banner', '.advertisement'];
  const YTCSS = ['#masthead-ad', '#player-ads', 'ytd-ad-slot-renderer', 'ytd-in-feed-ad-layout-renderer', 'ytd-banner-promo-renderer',
    'ytd-statement-banner-renderer', 'ytd-promoted-sparkles-web-renderer', 'ytd-promoted-video-renderer', 'ytd-display-ad-renderer',
    'ytd-companion-slot-renderer', 'ytd-action-companion-ad-renderer', '.ytp-ad-overlay-container', '.ytp-ad-overlay-slot',
    '.ytp-ad-image-overlay', '.ytp-ad-text-overlay', 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]'];

  const style = document.createElement('style'); style.id = 'wt-adblock-css';
  function apply() {
    document.documentElement.dataset.wtAdblock = on ? 'on' : 'off';
    if (on) {
      style.textContent = [...(YT ? YTCSS : []), ...GENERIC].join(',') + '{display:none!important}';
      if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    } else style.remove();
  }
  apply();
  try {
    chrome.storage.local.get('adblock').then((r) => { on = r.adblock !== false; apply(); });
    chrome.storage.onChanged.addListener((c) => { if (c.adblock) { on = c.adblock.newValue !== false; apply(); } });
  } catch {}

  if (!YT) return;
  // YouTube: skip whatever still slips through
  let inAd = false, saved = null;
  setInterval(() => {
    if (!on) return;
    const p = document.querySelector('.html5-video-player');
    if (!p) return;
    const v = p.querySelector('video');
    if (p.classList.contains('ad-showing')) {
      if (v) {
        if (!inAd) { inAd = true; saved = { muted: v.muted }; }
        v.muted = true; v.playbackRate = 16;
        if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) v.currentTime = v.duration - 0.05;
      }
      document.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-overlay-close-button')
        .forEach((b) => b.click());
    } else if (inAd) {
      inAd = false;
      if (v) { v.muted = saved ? saved.muted : false; v.playbackRate = 1; }
    }
  }, 250);
})();
