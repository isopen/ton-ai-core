const APP_URL = 'https://app9208241906.tgcloud.ai/';

const EMOJI = ['🐸', '🦄', '🐱', '🎅', '🐶', '🦊', '🐼', '🐵', '🐧', '🐢', '👻', '🍩'];

const FEATURED = ['PepeEmoji', 'DogeEmoji', 'Cat2O', 'UtyaD', 'TONEmoji', 'HalloweenTeamEmoji'];

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatCount(value) {
    const n = Math.max(0, Math.round(Number(value) || 0));
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function galleryTeaser(stats = {}) {
    const count = Number(stats.count) || 0;
    const packs = Number(stats.packs) || 0;
    const megabytes = ((Number(stats.bytes) || 0) / 1000000).toFixed(1);
    return [
        '<b>TGS Gallary</b> — animated emoji gallery',
        `${formatCount(count)} emoji · ${formatCount(packs)} packs · ${megabytes} MB`,
        'Rust/WASM renderer · 100 emoji per page',
    ].join('\n');
}

export function galleryWidget(stats = {}) {
    const count = Number(stats.count) || 0;
    const packs = Number(stats.packs) || 0;
    const bytes = Number(stats.bytes) || 0;
    const megabytes = (bytes / 1000000).toFixed(1);
    const names = Array.isArray(stats.names) ? stats.names : [];
    const featured = FEATURED.filter((name) => names.includes(name));
    const chips = (featured.length ? featured : names.slice(0, 6))
        .map((name) => `<span>${escapeHtml(name)}</span>`)
        .join('');
    const strip = EMOJI.map((emoji) => `<span>${emoji}</span>`).join('');

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
body{margin:0;padding:12px 12px 8px;font:14px/1.35 system-ui,sans-serif;color:var(--tg-theme-text-color)}
.head{display:flex;align-items:center;gap:10px}
.logo{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-weight:700;font-size:12px;letter-spacing:.5px;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
.title{font-size:16px;font-weight:600}
.sub{font-size:12px;color:var(--tg-theme-hint-color)}
.strip{display:flex;justify-content:space-between;margin:12px 0 10px;font-size:26px;line-height:1}
.strip span{display:inline-block;animation:bob 2.4s ease-in-out infinite}
.strip span:nth-child(2n){animation-delay:-.6s}
.strip span:nth-child(3n){animation-delay:-1.2s}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@media (prefers-reduced-motion:reduce){.strip span{animation:none}}
.stats{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--tg-theme-hint-color)}
.stats b{color:var(--tg-theme-text-color);font-weight:600}
.packs{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px}
.packs span{font-size:11px;padding:2px 7px;border-radius:99px;background:var(--tg-theme-secondary-bg-color);color:var(--tg-theme-subtitle-text-color)}
button{width:100%;padding:9px 12px;border:0;border-radius:9px;font:inherit;font-weight:600;background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}
button:active{filter:brightness(.92)}
.foot{margin-top:8px;font-size:11px;text-align:center;color:var(--tg-theme-hint-color)}
</style>
</head>
<body>
<div class="head"><div class="logo">TGS</div><div><div class="title">TGS Gallary</div><div class="sub">Animated emoji gallery</div></div></div>
<div class="strip" aria-hidden="true">${strip}</div>
<div class="stats"><span><b>${formatCount(count)}</b> emoji</span><span><b>${formatCount(packs)}</b> packs</span><span><b>${megabytes} MB</b></span></div>
<div class="packs">${chips}</div>
<button type="button" onclick="openGallery()">Open gallery</button>
<div class="foot">Rust/WASM renderer · 100 per page</div>
<script>
function openGallery() {
  try { TelegramWidget.openLink(${JSON.stringify(APP_URL)}); } catch (e) {}
}
</script>
</body>
</html>`;
}
