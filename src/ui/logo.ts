// Apex Atlas のロゴ（SVG）。地球儀のまわりを回るレースライン、頂点（apex）の光る点、斜めの文字。
// 出てくるとき：レースラインが描かれ、頂点が光り、文字が滑り込む。そのあと文字に光が流れる（動きは style.css）。

export function logoSvg(): string {
  return `
<svg class="logo" viewBox="0 0 740 220" role="img" aria-label="Apex Atlas">
  <defs>
    <linearGradient id="lg-word" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#ffd25a"/><stop offset="0.55" stop-color="#ffb000"/><stop offset="1" stop-color="#ff6a1a"/>
    </linearGradient>
    <linearGradient id="lg-globe" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9fd8ff"/><stop offset="1" stop-color="#2e7fd6"/>
    </linearGradient>
    <radialGradient id="lg-apex"><stop offset="0" stop-color="#fff"/><stop offset="0.35" stop-color="#ffd25a"/><stop offset="1" stop-color="#ff8a00" stop-opacity="0"/></radialGradient>
    <linearGradient id="lg-shine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="lg-text"><text x="236" y="122" class="logo-word-text"><tspan>APEX</tspan><tspan dx="14">ATLAS</tspan></text></clipPath>
  </defs>
  <!-- 地球儀 -->
  <g class="logo-globe" transform="translate(110 110)">
    <circle r="72" fill="#06111f" stroke="url(#lg-globe)" stroke-width="5"/>
    <ellipse rx="30" ry="72" fill="none" stroke="#5fb4ff" stroke-opacity="0.55" stroke-width="2.5"/>
    <ellipse rx="58" ry="72" fill="none" stroke="#5fb4ff" stroke-opacity="0.3" stroke-width="2"/>
    <path d="M -70 -18 Q 0 -8 70 -18 M -70 22 Q 0 32 70 22" fill="none" stroke="#5fb4ff" stroke-opacity="0.35" stroke-width="2"/>
  </g>
  <!-- レースライン（地球儀を斜めに回る） -->
  <path class="logo-orbit" d="M 18 150 C 40 70, 200 20, 214 74 C 226 122, 120 176, 40 150" fill="none" stroke="#ffb000" stroke-width="7" stroke-linecap="round"/>
  <circle class="logo-apex-glow" cx="213" cy="78" r="26" fill="url(#lg-apex)"/>
  <circle class="logo-apex" cx="213" cy="78" r="7" fill="#fff"/>
  <!-- 文字 -->
  <g class="logo-word">
    <text x="236" y="122" class="logo-word-text"><tspan fill="#f2f5f8">APEX</tspan><tspan fill="url(#lg-word)" dx="14">ATLAS</tspan></text>
    <g clip-path="url(#lg-text)"><rect class="logo-shine" x="0" y="30" width="110" height="120" fill="url(#lg-shine)" transform="skewX(-20)"/></g>
    <path class="logo-speed" d="M 244 146 H 700 M 300 158 H 640" stroke="#ffb000" stroke-width="3" stroke-linecap="round" stroke-opacity="0.8"/>
  </g>
</svg>`;
}
