// 사진: 지역 풍경(지도 타일 배경), 단지 전경(단지 카드 위).
// 우선순위: 관리자가 올린 사진(DB) > 관광공사 수집 사진(data/{지역}/media.json) > 디자인 톤 그림(사진 없음)
(() => {
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const M = { region: {}, complex: {}, ready: null };

async function load(dataBase) {
  try { const r = await fetch(`${dataBase}media.json`); if (r.ok) { const j = await r.json(); Object.assign(M.region, j.region || {}); Object.assign(M.complex, j.complex || {}); } } catch (e) {}
  try { const B = await window.getBackend(); for (const p of await B.photos()) M[p.kind][p.ref] = p; } catch (e) {}
}

// ---------- 지역: 사진이 없을 때 쓰는 풍경 실루엣 ----------
const CITY = ["동구", "서구", "남구", "북구", "광산구", "중구", "수성구", "달서구", "유성구"];
const SEA = ["목포시", "여수시", "완도군", "신안군", "진도군", "고흥군", "해남군", "무안군", "영광군", "강진군", "장흥군", "보성군", "광양시", "통영시", "거제시", "속초시", "강릉시", "서귀포시", "제주시"];
const scene = sgg => CITY.includes(sgg) ? "city" : SEA.includes(sgg) ? "sea" : "hills";
const svgUrl = s => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const SCENES = {
  city: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" preserveAspectRatio="xMidYMax slice"><g fill="#fff" fill-opacity=".16"><rect x="8" y="52" width="16" height="48"/><rect x="28" y="38" width="14" height="62"/><rect x="46" y="58" width="22" height="42"/><rect x="72" y="28" width="12" height="72"/><rect x="88" y="46" width="18" height="54"/><rect x="110" y="34" width="14" height="66"/><rect x="128" y="56" width="20" height="44"/><rect x="152" y="42" width="12" height="58"/><rect x="168" y="60" width="24" height="40"/></g></svg>`),
  sea: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" preserveAspectRatio="xMidYMax slice"><g fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="2.2"><path d="M0 78 q12 -6 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0"/><path d="M0 90 q12 -6 25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0 t25 0"/></g><path d="M120 70 L150 46 L176 70 Z" fill="#fff" fill-opacity=".14"/></svg>`),
  hills: svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" preserveAspectRatio="xMidYMax slice"><path d="M0 100 L0 70 Q30 44 62 66 T130 58 T200 64 L200 100 Z" fill="#fff" fill-opacity=".12"/><path d="M0 100 L0 84 Q40 66 90 82 T200 78 L200 100 Z" fill="#fff" fill-opacity=".14"/></svg>`),
};
function rgba(hex, a) {
  const h = hex.replace("#", ""), n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
// 지도 타일 배경: 사진이 있으면 신호색을 덮어 같은 톤으로, 없으면 신호색 + 풍경 실루엣
function tileBg(sido, sgg, color) {
  const p = M.region[`${sido}|${sgg}`];
  if (p) return { background: `linear-gradient(180deg, ${rgba(color, .58)}, ${rgba(color, .86)}), url("${p.url.replace(/"/g, "%22")}") center/cover no-repeat, ${color}`, photo: p };
  return { background: `${SCENES[scene(sgg)]} center bottom/100% auto no-repeat, ${color}`, photo: null };
}

// ---------- 단지: 사진 또는 그림 ----------
function hash(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; }
function illustration(c) {
  // 층수(최고층)와 준공연도만으로 그린 단지 그림. 실제 모습이 아님을 캡션에 밝힌다
  const fl = Math.max(3, Math.min(45, c.maxfl || 12)), old = (c.built || 2005) < 2000, h0 = hash(c.key || c.name);
  const W = 640, H = 200, ground = 176, n = old ? 3 : 4;
  let out = "";
  for (let i = 0; i < n; i++) {
    const r = (h0 >> (i * 5)) & 31, bw = old ? 150 : 70 + (r % 3) * 8;
    const bh = Math.min(150, 28 + fl * (old ? 3.2 : 3.4) * (0.82 + (r % 5) * 0.06));
    const x = old ? 40 + i * 190 : 70 + i * 135 + (r % 4) * 6, y = ground - bh;
    const rows = Math.max(2, Math.round(bh / 14)), cols = old ? 8 : 3;
    let win = "";
    for (let rr = 0; rr < rows - 1; rr++) for (let cc = 0; cc < cols; cc++) {
      if (((h0 >> ((rr + cc) % 24)) & 3) === 0) continue;
      win += `<rect x="${x + 10 + cc * ((bw - 20) / cols)}" y="${y + 10 + rr * 14}" width="${(bw - 20) / cols - 6}" height="6" rx="1"/>`;
    }
    out += `<g><rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${old ? 2 : 4}" fill="var(--card)" stroke="var(--line)"/>${old ? "" : `<rect x="${x + bw / 2 - 8}" y="${y - 8}" width="16" height="8" rx="2" fill="var(--line)"/>`}<g fill="var(--brand)" fill-opacity=".22">${win}</g></g>`;
  }
  return `<svg class="hero-ill" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" role="img" aria-label="단지 그림 (실제 사진 아님)">
    <defs><linearGradient id="sky-${h0}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--brand-soft)"/><stop offset="1" stop-color="var(--soft)"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#sky-${h0})"/><circle cx="${560 - (h0 % 80)}" cy="46" r="18" fill="var(--region)" fill-opacity=".18"/>
    ${out}<rect y="${ground}" width="${W}" height="${H - ground}" fill="var(--line)" fill-opacity=".7"/></svg>`;
}
function hero(c) {
  const p = M.complex[c.key];
  if (p) return `<figure class="hero"><img src="${esc(p.url)}" alt="${esc(c.name)} 전경" loading="lazy" onerror="this.closest('figure').classList.add('broken')"><figcaption>사진: ${esc(p.credit)} · ${esc(p.license)}</figcaption></figure>`;
  return `<figure class="hero ill">${illustration(c)}<figcaption>사진 준비 중 · 최고 ${c.maxfl || "?"}층, ${c.built || "?"}년 준공으로 그린 그림</figcaption></figure>`;
}
function regionCredits(sido, list) {
  const ps = list.map(sgg => M.region[`${sido}|${sgg}`]).filter(Boolean);
  if (!ps.length) return "";
  const names = [...new Set(ps.map(p => p.credit))].slice(0, 3).join(", ");
  return `지도 사진: ${esc(names)}${ps.length > 3 ? " 외" : ""} (${esc([...new Set(ps.map(p => p.license))].join(", "))})`;
}

window.Media = { load: base => (M.ready = load(base)), tileBg, hero, illustration, regionCredits, get state() { return M; } };
})();
