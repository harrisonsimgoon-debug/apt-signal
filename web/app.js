// 우리집 시세 신호 — 화면 로직. 데이터: data/index.json, data/c/{시도ID}.json (pipeline/build.py 가 만든다)
(() => {
const $ = id => document.getElementById(id);
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const eok = v => { const x = v / 10000; return (x >= 10 ? x.toFixed(1) : x.toFixed(2)).replace(/\.?0+$/, "") + "억"; };
const ym = s => { const [y, m] = s.split("-"); return `${y}년 ${+m}월`; };
const walk = m => Math.max(1, Math.round(m / 67));
const RG = window.REGION || { slug: "jeonnam-gwangju", label: "전남광주" };
const DATA = `data/${RG.slug}/`;
// 지역 페이지 하나가 여러 시도를 묶을 수 있다. 시도가 하나뿐이면 페이지 이름(예: 전남광주)으로 부른다.
const short = s => (S.idx && S.idx.sidos.length === 1) ? RG.label : s.replace(/(특별자치시|특별자치도|특별시|광역시|도)$/, "");
const WORD = { up: "오를 신호", flat: "평균", down: "약한 신호" };
const ICON = { up: "▲", down: "▼", flat: "–" };
const S = { idx: null, files: {}, cur: null, sido: null, mapSid: null, sgg: null, sort: "score" };

async function getJSON(p) { const r = await fetch(p); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); }
async function sidoFile(sid) {
  if (!S.files[sid]) {
    const d = await getJSON(`${DATA}c/${sid}.json`);
    d.byId = new Map(d.cx.map(c => [c.id, c]));
    S.files[sid] = d;
  }
  return S.files[sid];
}

// ---------- 단지 열기 ----------
async function openCx(sid, id, opts = {}) {
  const f = await sidoFile(sid), c = f.byId.get(id);
  if (!c) return;
  S.cur = c; S.sido = f; S.sgg = c.sgg;
  S.pick = opts.pick || null;            // 첫 화면 자동 선택 이유 (사용자가 고르면 지움)
  if (!opts.auto) S.touched = true;
  if (S.mapSid !== null || opts.zoom) S.mapSid = sid;
  try { history.replaceState(null, "", `#c-${sid}-${id}`); } catch (e) {}
  renderResult(); renderWhy(); renderTrend(); askSetup(); renderInfra(); drawMap(); renderList();
  fillAds();
  if (opts.toMain) setTab("main");
}

function renderResult() {
  const c = S.cur, region = short(S.sido.sido), v = S.idx.meta.validation;
  const SAY = { up: `${region} 다른 아파트보다 더 오를 가능성이 높은 편이에요`, flat: `${region} 평균과 비슷하게 움직일 가능성이 커요`, down: `${region} 평균보다 약하게 움직일 가능성이 있어요` };
  const n = c.n1 + c.n2, conf = n >= 8 ? "높음" : n >= 3 ? "보통" : "낮음";
  $("result").innerHTML = `
    ${window.Media ? window.Media.hero(c) : ""}
    ${pickLine()}
    <div class="where">${RG.label} ${c.sgg} ${c.umd}${c.built ? ` · ${c.built}년 준공` : ""}</div>
    <div class="apt">${c.name}</div>
    ${brandChip(c)}
    <div class="verdict v-${c.lv}">
      <div class="ai">AI 시세 신호 · 앞으로 4개월 안팎</div>
      <div class="say">${SAY[c.lv]}</div>
      <div class="score"><b>${c.score}</b><span>/ 100점 · 50점이 ${region} 평균</span></div>
      <div class="gauge" aria-hidden="true"><i style="left:${c.score}%"></i></div>
      <div class="gscale"><span>약한 신호</span><span>평균</span><span>오를 신호</span></div>
    </div>
    <p class="conf">판단 신뢰도 <b>${conf}</b> · 최근 6개월 이 단지 거래 ${n}건${conf === "낮음" ? " · 거래가 적어 지역 흐름 위주로 판단했어요" : ""}</p>
    ${v ? `<div class="proof">과거 데이터로 시험해 보니 <b>'오를 신호' 단지의 ${Math.round(v.up_hit * 100)}%</b>가 이후 2% 넘게 올랐어요. 전체 평균은 ${Math.round(v.base * 100)}%였어요.</div>` : ""}`;
}

// ---------- 첫 화면: 위치 기반 단지 ----------
const geoReady = () => (S.idx.meta.geo_cover || 0) > 0;
function pickLine() {
  const p = S.pick; if (!p) return "";
  const why = p.how === "location"
    ? `내 위치 근처 <b>${p.area}</b>에서 AI 점수가 가장 높은 단지예요${p.nearest && p.nearest !== S.cur.name ? ` · 가장 가까운 단지는 ${p.nearest}` : ""}`
    : p.how === "far" ? `지금 위치가 ${RG.label} 밖이라 거래가 가장 많은 <b>${p.area}</b>에서 점수가 가장 높은 단지를 보여드려요`
    : `<b>${p.area}</b>(최근 거래가 가장 많은 곳)에서 AI 점수가 가장 높은 단지예요`;
  const btn = p.how !== "location" && geoReady() ? ` <button class="link" type="button" id="pick-locate">내 위치로 찾기</button>` : "";
  return `<p class="pick" id="pick">${why}. 최근 6개월 거래 ${window.Geo.MIN_TRADES}건 이상인 단지 중에서 골랐어요.${btn}</p>`;
}
document.addEventListener("click", e => { if (e.target.id === "pick-locate") locate(true); });
function locate(byUser) {
  if (!geoReady()) { if (byUser) window.Account.toast("단지 위치 정보를 모으는 중이라 아직 내 위치로 찾을 수 없어요"); return; }
  if (!("geolocation" in navigator)) { if (byUser) window.Account.toast("이 브라우저는 위치 확인을 지원하지 않아요"); return; }
  navigator.geolocation.getCurrentPosition(async pos => {
    if (S.touched && !byUser) return;   // 그 사이 사용자가 다른 단지를 골랐으면 바꾸지 않는다
    const p = window.Geo.pickDefault(S.idx.search, { lat: pos.coords.latitude, lng: pos.coords.longitude });
    if (p) await openCx(p.entry.sid, p.entry.id, { auto: true, pick: p });
  }, () => { if (byUser) window.Account.toast("위치를 확인할 수 없어요. 브라우저에서 위치 권한을 허용해 주세요"); },
  { timeout: 8000, maximumAge: 600000, enableHighAccuracy: false });
}

function brandChip(c) {
  if (!c.brand) return "";
  const b = (S.idx.brands || []).find(x => x.brand === c.brand);
  return `<button class="brand-chip" type="button" data-brand="${c.brand}">${c.brand}${b ? ` · 브랜드 순위 ${b.rank}위` : ""}</button>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest(".brand-chip"); if (!b) return;
  openBrand(b.dataset.brand);
});

function renderWhy() {
  const c = S.cur, jq = S.sido.jeonse_q, region = short(S.sido.sido), out = [];
  if (c.reg_mom != null) {
    const v = c.reg_mom;
    out.push({ w: c.w.reg_mom, dir: v > 1 ? "up" : v < -1 ? "down" : "flat", src: "국토교통부 실거래 · 같은 단지 같은 평형 비교",
      text: (v > 1 ? `${c.sgg} 아파트 실거래가가 최근 3개월 ${v.toFixed(1)}% 올랐어요.` : v < -1 ? `${c.sgg} 아파트 실거래가가 최근 3개월 ${(-v).toFixed(1)}% 내렸어요.` : `${c.sgg} 아파트 실거래가는 최근 3개월 거의 그대로예요.`) + " 지역 흐름이 강한 곳의 단지가 이후에도 더 오르는 경향이 있었어요." });
  }
  if (c.jeonse != null && jq && jq[0] != null) {
    const v = c.jeonse;
    out.push({ w: c.w.jeonse, dir: v >= jq[2] ? "up" : v < jq[0] ? "down" : "flat", src: "국토교통부 전월세 실거래",
      text: v >= jq[2] ? `전세가가 매매가의 ${v.toFixed(0)}%로 ${region}에서 높은 편이에요(중간 ${jq[1].toFixed(0)}%). 실제 살려는 수요가 가격을 받쳐줘요.`
        : v < jq[0] ? `전세가가 매매가의 ${v.toFixed(0)}%로 ${region}에서 낮은 편이에요(중간 ${jq[1].toFixed(0)}%). 전세가율이 낮은 단지는 이후 상승폭이 작은 편이었어요.`
        : `전세가가 매매가의 ${v.toFixed(0)}%로 ${region} 중간 수준이에요(중간 ${jq[1].toFixed(0)}%).` });
  } else out.push({ w: 0, dir: "flat", src: "국토교통부 전월세 실거래", text: "최근 전세 거래가 없어 전세가율은 판단에서 뺐어요." });
  const a = c.n2, b = c.n1, up = a > b * 1.3 && a >= 2, dn = a < b * 0.7;
  out.push({ w: c.w.cx_vol_chg, dir: up ? "up" : dn ? "down" : "flat", src: "국토교통부 실거래 신고 건수",
    text: up ? `최근 3개월 이 단지 거래가 ${a}건으로 그 전 3개월(${b}건)보다 늘었어요.` : dn ? `최근 3개월 이 단지 거래가 ${a}건으로 그 전 3개월(${b}건)보다 줄었어요.` : `최근 3개월 이 단지 거래는 ${a}건으로 그 전과 비슷해요.` });
  out.sort((x, y) => Math.abs(y.w) - Math.abs(x.w));
  $("why").innerHTML = out.map(o => `<li><span class="ic ${o.dir}">${ICON[o.dir]}</span><div><p>${o.text}</p><small>근거: ${o.src}</small></div></li>`).join("");
}

// ---------- 시세 흐름 ----------
function renderTrend() {
  const c = S.cur, M = S.idx.meta.months, el = $("trend");
  $("trend-h").textContent = `최근 1년 실거래가 흐름 · 전용 ${c.area}㎡`;
  const pts = c.series.map((v, i) => ({ v, i })).filter(p => p.v != null);
  if (pts.length < 2) { el.innerHTML = `<p class="note">월별로 그릴 만큼 거래가 많지 않아요.</p>`; return; }
  const n = c.series.length, w = 640, h = 170, px = 10, py = 18, vs = pts.map(p => p.v), lo = Math.min(...vs) * .97, hi = Math.max(...vs) * 1.03;
  const X = i => px + i * (w - 2 * px) / (n - 1), Y = v => h - py - (v - lo) / (hi - lo) * (h - 2 * py);
  const f = pts[0], l = pts.at(-1), col = l.v >= f.v ? "var(--up)" : "var(--down)", diff = (l.v / f.v - 1) * 100;
  el.innerHTML = `<p style="margin:0 0 8px">최근 월 중간 거래가 <b>${eok(l.v)}</b> · ${ym(M[f.i])}보다 <b style="color:${col}">${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%</b></p>
    <svg viewBox="0 0 ${w} ${h}" role="img" aria-label="월별 중간 거래가">
      <line x1="${px}" x2="${w - px}" y1="${Y(f.v)}" y2="${Y(f.v)}" stroke="var(--line)" stroke-dasharray="4 4"/>
      <polyline points="${pts.map(p => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(" ")}" fill="none" stroke="${col}" stroke-width="2.5" stroke-linejoin="round"/>
      ${pts.map(p => `<circle cx="${X(p.i)}" cy="${Y(p.v)}" r="${p === l ? 5 : 3}" fill="${col}"/>`).join("")}
    </svg>
    <div class="cap"><span>${ym(M[0])}</span><span>${ym(M.at(-1))}</span></div>
    <p class="note">거래가 없는 달은 비워 뒀어요. 월 중간값이라 층·향에 따라 흔들릴 수 있어요.</p>`;
}

// ---------- 호가 판단 ----------
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b), i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
function askSetup() {
  const c = S.cur;
  $("ask-label").textContent = `전용 ${c.area}㎡ (${c.band}) 매수 고려 가격`;
  $("askv").value = c.adj.length ? (Math.round(q(c.adj, .5) / 1000) / 10).toFixed(1) : "";
  askRender();
}
function askRender() {
  const c = S.cur, a = c.adj, ask = parseFloat($("askv").value) * 10000, out = $("ask-out");
  if (!a.length) { out.innerHTML = `<p class="note">최근 1년 같은 평형 거래가 없어 비교할 수 없어요.</p>`; return; }
  if (!(ask > 0)) { out.innerHTML = `<p class="note">가격을 억 단위로 입력하면 최근 실거래와 비교해 드려요.</p>`; return; }
  const med = q(a, .5), lo = q(a, .25), hi = q(a, .75), pos = ask / med - 1, cheaper = a.filter(v => v < ask).length / a.length, vsPeak = ask / c.peak - 1;
  const cls = Math.abs(pos) < .02 ? "" : pos > 0 ? "hi" : "lo";
  const head = Math.abs(pos) < .02 ? `최근 시세(${eok(med)})와 비슷한 가격이에요` : pos > 0 ? `최근 시세(${eok(med)})보다 ${Math.round(pos * 100)}% 비싸요` : `최근 시세(${eok(med)})보다 ${Math.round(-pos * 100)}% 싸요`;
  const w = 640, h = 72, pad = 12, mn = Math.min(...a, ask) * .97, mx = Math.max(...a, ask) * 1.03, X = v => pad + (v - mn) / (mx - mn) * (w - 2 * pad);
  const ax = X(ask), anchor = ax > w - 70 ? "end" : ax < 70 ? "start" : "middle";
  out.innerHTML = `<div class="ask-say ${cls}">${head}</div>
    <p class="note" style="margin:0">최근 1년 같은 평형 거래 ${a.length}건 중 ${Math.round(cheaper * 100)}%가 이 가격보다 낮게 거래됐어요.</p>
    <div class="dist"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="최근 거래가 분포와 입력한 가격">
      <rect x="${X(lo)}" y="14" width="${Math.max(2, X(hi) - X(lo))}" height="32" rx="4" fill="var(--brand)" fill-opacity=".14"/>
      ${a.map((v, i) => `<circle cx="${X(v).toFixed(1)}" cy="${30 + ((i * 7) % 5 - 2) * 4}" r="4" fill="var(--flat)" fill-opacity=".6"/>`).join("")}
      <line x1="${ax}" x2="${ax}" y1="6" y2="54" stroke="var(--ink)" stroke-width="2.5"/>
      <text x="${ax}" y="${h - 2}" text-anchor="${anchor}" font-size="13" font-weight="700" fill="var(--ink)">입력 ${eok(ask)}</text>
    </svg></div>
    <div class="facts">
      <div><small>최근 시세 중간</small><b>${eok(med)}</b></div>
      <div><small>보통 거래 범위</small><b>${eok(lo)}~${eok(hi)}</b></div>
      <div><small>1년 최고가 대비</small><b>${vsPeak >= 0 ? "+" : ""}${Math.round(vsPeak * 100)}%</b></div>
    </div>
    <p class="note">거래 시점의 지역 시세 변화를 반영해 지금 기준으로 환산했어요. 1년 최고가는 ${eok(c.peak)}(${c.peak_m.replace(".", "년 ")}월)이에요.${a.length < 5 ? " 거래가 적어 참고만 해주세요." : ""}</p>`;
}
$("askv").addEventListener("input", askRender);

// ---------- 생활 인프라 ----------
const IC = {
  subway: '<path d="M7 3h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm-3 8h16M8 21l2-3m6 3-2-3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="14.5" r="1" fill="currentColor"/><circle cx="16" cy="14.5" r="1" fill="currentColor"/>',
  school: '<path d="M3 9.5 12 5l9 4.5-9 4.5-9-4.5Zm4 2V16c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  mart: '<path d="M4 5h2l2 10h10l2-7H7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="9.5" cy="19" r="1.4" fill="currentColor"/><circle cx="16.5" cy="19" r="1.4" fill="currentColor"/>',
  park: '<path d="M12 21v-6m0 0c-3.3 0-6-2.2-6-5.5S8.7 3 12 3s6 3.2 6 6.5-2.7 5.5-6 5.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  hospital: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  kids: '<circle cx="12" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};
const SAMPLE_INFRA = { subway: { name: "○○역", m: 420 }, elem: { name: "○○초등학교", m: 260 }, middle: { name: "○○중학교", m: 780 }, mart: { name: "○○마트", m: 1150 }, park: { name: "○○근린공원", m: 310 }, hospital_1km: 23, kids_500m: 6 };
function renderInfra(sample = false) {
  const el = $("infra"), d = sample ? SAMPLE_INFRA : S.cur.infra;
  if (!d || (!d.subway && !d.elem && !d.mart && d.hospital_1km == null)) {
    el.innerHTML = `<h2>생활 인프라</h2>
      <p class="note" style="margin-top:0">${d ? "이 단지는 위치를 찾지 못해 주변 정보를 표시할 수 없어요." : "주변 인프라는 자동 수집을 연결하면 매일 채워져요. 지하철역·초중학교·대형마트·공원까지 걸어서 몇 분인지, 1km 안 병원 수와 500m 안 어린이집·유치원 수를 보여줘요."}</p>
      ${d ? "" : `<button class="link" id="infra-sample">화면 예시 보기</button>`}`;
    const b = $("infra-sample"); if (b) b.onclick = () => renderInfra(true);
    return;
  }
  const row = (ic, label, p) => p ? `<li><svg viewBox="0 0 24 24" aria-hidden="true">${IC[ic]}</svg><span class="nm">${p.name}<small>${label}</small></span><span class="val">도보 ${walk(p.m)}분 · ${p.m >= 1000 ? (p.m / 1000).toFixed(1) + "km" : p.m + "m"}</span></li>`
    : `<li><svg viewBox="0 0 24 24" aria-hidden="true">${IC[ic]}</svg><span class="nm">가까이 없음<small>${label}</small></span><span class="val">–</span></li>`;
  const cnt = (ic, label, n) => `<li><svg viewBox="0 0 24 24" aria-hidden="true">${IC[ic]}</svg><span class="nm">${label}</span><span class="val">${n ?? "–"}곳</span></li>`;
  const badges = [];
  if (d.subway && d.subway.m <= 500) badges.push("역세권 · 지하철 도보 " + walk(d.subway.m) + "분");
  if (d.elem && d.elem.m <= 400) badges.push("초등학교 도보 " + walk(d.elem.m) + "분");
  if (d.park && d.park.m <= 400) badges.push("공원 가까움");
  if (d.mart && d.mart.m <= 1000) badges.push("대형마트 1km 안");
  el.innerHTML = `<h2>생활 인프라${sample ? '<span class="sample-tag">예시 화면 · 실제 데이터 아님</span>' : ""}</h2>
    ${badges.length ? `<div class="badges">${badges.map(b => `<span class="badge">${b}</span>`).join("")}</div>` : ""}
    <ul class="inf">
      ${row("subway", "가장 가까운 지하철역", d.subway)}
      ${row("school", "가장 가까운 초등학교", d.elem)}
      ${row("school", "가장 가까운 중학교", d.middle)}
      ${row("mart", "가장 가까운 대형마트", d.mart)}
      ${row("park", "가장 가까운 공원", d.park)}
      ${cnt("hospital", "반경 1km 병원·의원", d.hospital_1km)}
      ${cnt("kids", "반경 500m 어린이집·유치원", d.kids_500m)}
    </ul>
    <p class="note">직선거리 기준이라 실제 걷는 시간은 더 걸릴 수 있어요. 출처: 카카오 로컬${sample ? ` · <button class="link" id="infra-back">닫기</button>` : ""}</p>`;
  const bk = $("infra-back"); if (bk) bk.onclick = () => renderInfra(false);
}

// ---------- 지역 지도 ----------
function drawMap() {
  const E = $("map"), W = E.clientWidth, H = E.clientHeight;
  if (!W || !S.idx) return;
  const regs = S.idx.regions.filter(r => !S.mapSid || r.sid === S.mapSid);
  const nation = !S.mapSid && S.idx.sidos.length > 1;
  const tree = nation ? { children: S.idx.sidos.map(s => ({ name: s.sido, sid: s.sid, children: regs.filter(r => r.sid === s.sid) })) } : { children: regs };
  const root = d3.hierarchy(tree).sum(d => d.trades != null ? Math.max(d.trades, 6) : 0).sort((a, b) => b.value - a.value);
  d3.treemap().size([W, H]).paddingInner(2).paddingTop(d => nation && d.depth === 1 ? 16 : 0).tile(d3.treemapSquarify.ratio(1.3))(root);
  E.innerHTML = "";
  const COL = { up: css("--up"), flat: css("--flat"), down: css("--down") };
  if (nation) for (const g of root.children) {
    const el = document.createElement("div"); el.className = "grp";
    Object.assign(el.style, { left: g.x0 + "px", top: g.y0 + "px", width: (g.x1 - g.x0) + "px", height: (g.y1 - g.y0) + "px" });
    el.innerHTML = `<b style="max-width:${g.x1 - g.x0 - 6}px">${short(g.data.name)}</b>`;
    el.firstChild.onclick = () => { S.mapSid = g.data.sid; drawMap(); };
    E.appendChild(el);
  }
  for (const n of root.leaves()) {
    const r = n.data, w = n.x1 - n.x0, h = n.y1 - n.y0, b = document.createElement("button");
    b.className = "tile" + (S.cur && r.sgg === S.sgg && r.sid === S.sido?.sid ? " sel" : "");
    const tb = window.Media ? window.Media.tileBg(r.sido, r.sgg, COL[r.lv]) : { background: COL[r.lv] };
    Object.assign(b.style, { left: n.x0 + "px", top: n.y0 + "px", width: w + "px", height: h + "px", background: tb.background });
    if (tb.photo) b.classList.add("has-photo");
    const m = r.mom == null ? "–" : `${r.mom > 0 ? "+" : ""}${r.mom.toFixed(1)}%`;
    b.setAttribute("aria-label", `${r.sido} ${r.sgg} 최근 3개월 ${m}, 거래 ${r.trades}건`);
    b.title = `${r.sgg} ${m} · 거래 ${r.trades}건`;
    if (w > 40 && h > 24) b.innerHTML = `<span class="n">${r.sgg}</span>${h > 40 ? `<span class="w">${m}</span>` : ""}`;
    b.onclick = async () => { S.sgg = r.sgg; S.listSid = r.sid; await renderList(r.sid); drawMap(); };
    E.appendChild(b);
  }
  const credit = $("map-credit");
  if (credit && window.Media) credit.innerHTML = window.Media.regionCredits(regs[0]?.sido, regs.map(r => r.sgg));
  const multi = S.idx.sidos.length > 1;
  $("map-h").textContent = S.mapSid ? `${short(S.idx.sidos.find(s => s.sid === S.mapSid).sido)} 흐름` : multi ? "전국 흐름" : `${short(S.idx.sidos[0].sido)} 흐름`;
  $("map-back").hidden = !(multi && S.mapSid);
}
$("map-back").onclick = () => { S.mapSid = null; drawMap(); };

async function renderList(sid) {
  sid = sid || S.listSid || S.sido?.sid; if (!sid || !S.sgg) return;
  S.listSid = sid;
  const f = await sidoFile(sid);
  let cx = f.cx.filter(c => c.sgg === S.sgg);
  if (S.sort === "score") cx = cx.filter(c => c.n1 + c.n2 >= 3).sort((a, b) => b.score - a.score);
  else cx = cx.sort((a, b) => (b.n1 + b.n2) - (a.n1 + a.n2));
  cx = cx.slice(0, 40);
  $("list-h").textContent = `${short(f.sido)} ${S.sgg} · ${S.sort === "score" ? "점수 높은 단지 (최근 6개월 거래 3건 이상)" : "거래 많은 단지"}`;
  $("sortbar").hidden = false;
  $("list").innerHTML = cx.length ? cx.map(c => `<li><button data-id="${c.id}" ${S.cur && S.cur.id === c.id && S.sido.sid === sid ? 'aria-current="true"' : ""}><span>${c.name} <small>${c.umd}${c.built ? ` · ${c.built}년` : ""} · 거래 ${c.n1 + c.n2}건</small></span><span class="pill ${c.lv}">${WORD[c.lv]} ${c.score}</span></button></li>`).join("")
    : `<li class="note">조건에 맞는 단지가 없어요.</li>`;
  $("list").querySelectorAll("button").forEach(b => b.onclick = () => { openCx(sid, +b.dataset.id, { toMain: true }); window.scrollTo({ top: 0 }); });
  // 목록 4번째 줄에 추천 광고
  if (window.Ads && cx.length >= 3) {
    const li = await window.Ads.native({ sido: f.sido, sgg: S.sgg });
    const third = $("list").children[2];
    if (li && third && S.listSid === sid) third.after(li);
  }
}
$("sortbar").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; S.sort = b.dataset.s; for (const x of b.parentNode.children) x.setAttribute("aria-pressed", x === b); renderList(); });

// ---------- 브랜드 순위 ----------
const BS = { key: "index" };
const won = v => v == null ? "–" : `${Math.round(v).toLocaleString("ko-KR")}만`;
function renderBrands() {
  const list = [...(S.idx.brands || [])], k = BS.key, el = $("brand-list");
  if (!list.length) { el.innerHTML = `<li class="note">브랜드 순위를 낼 만큼 거래가 쌓이지 않았어요.</li>`; return; }
  list.sort((a, b) => (b[k] ?? -1e9) - (a[k] ?? -1e9));
  const top = Math.max(...list.map(b => b.index));
  el.innerHTML = list.map((b, i) => `<li><details data-brand="${b.brand}">
    <summary>
      <span class="b-rank${i < 3 ? " top" : ""}">${i + 1}</span>
      <span class="b-name"><b>${b.brand}</b><small>${b.company} · 단지 ${b.complexes}곳</small></span>
      <span class="b-index" aria-label="종합지수 ${b.index}"><i style="width:${(b.index / top * 100).toFixed(1)}%"></i><b>${b.index.toFixed(1)}</b></span>
      <span class="b-stats">
        <span><small>동네 시세 대비</small><b class="${b.premium >= 0 ? "pos" : "neg"}">${b.premium == null ? "–" : `${b.premium > 0 ? "+" : ""}${b.premium.toFixed(0)}%`}</b></span>
        <span><small>AI 점수</small><b>${b.score.toFixed(0)}</b></span>
        <span><small>평당가</small><b>${won(b.py)}</b></span>
        <span><small>6개월 거래</small><b>${b.trades.toLocaleString("ko-KR")}건</b></span>
      </span>
    </summary>
    <div class="b-top"><small>AI 점수 높은 단지</small>
      <ul>${b.top.map(t => `<li><button type="button" data-cx="${t.id}">${t.name} <small>${t.sgg} ${t.umd} · 거래 ${t.n6}건</small><span class="pill ${t.score >= 60 ? "up" : t.score >= 42 ? "flat" : "down"}">${t.score}</span></button></li>`).join("")}</ul>
    </div>
  </details></li>`).join("");
  el.querySelectorAll("[data-cx]").forEach(btn => btn.onclick = () => { openCx(findSid(+btn.dataset.cx), +btn.dataset.cx, { toMain: true }); window.scrollTo({ top: 0 }); });
  $("brands-sub").textContent = `우리집 AI시세 종합지수 · ${ym(S.idx.meta.data_to)} 실거래까지 · 단지 3곳, 거래 10건 이상 브랜드 ${list.length}개`;
  $("brands-note").textContent = `종합지수는 같은 시군구 다른 아파트보다 얼마나 비싸게 거래되는지(가격 프리미엄 45%), 단지들의 AI 시세 점수(35%), 단지당 거래 활발도(20%)를 합쳐 50점을 평균으로 맞춘 값이에요. 단지가 적은 브랜드는 평균 쪽으로 보정했어요. 단지명으로 브랜드를 나눴기 때문에 이름에 브랜드가 없는 단지(전체의 ${100 - S.idx.meta.brand_cover}%)는 빠져 있어요. 시공사 공식 평가가 아니에요.`;
}
const findSid = id => (S.idx.search.find(e => e[1] === id) || [])[0];
function openBrand(name) {
  setTab("brands");
  const d = document.querySelector(`#brand-list details[data-brand="${CSS.escape(name)}"]`);
  if (d) { d.open = true; d.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
}
$("brand-sort").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; BS.key = b.dataset.k; for (const x of b.parentNode.children) x.setAttribute("aria-pressed", x === b); renderBrands(); });

// ---------- 광고 ----------
let adCtxKey = "";
function fillAds() {
  if (!window.Ads || !S.cur) return;
  const ctx = { sido: S.sido.sido, sgg: S.cur.sgg, umd: S.cur.umd, lat: S.cur.lat, lng: S.cur.lng }, key = ctx.sido + "|" + ctx.sgg;
  window.Ads.fill("agent_box", $("ad-agent"), { ...ctx, name: S.cur.name });
  window.Ads.fill("side_box", $("ad-side"), ctx);
  window.Ads.fill("region_box", $("ad-region"), ctx);
  if (key !== adCtxKey) { adCtxKey = key; window.Ads.fill("top_banner", $("ad-top"), ctx); }
}
if (window.Account) window.Account.onChange(() => { adCtxKey = ""; fillAds(); });

// ---------- 검색 ----------
// 실거래 자료의 단지명은 줄여 쓴 이름이 많다(예: 금호동 '라인'을 사람들은 '금호라인아파트'라고 부름).
// 그래서 동 이름 앞부분 + 단지명, 시군구 + 단지명처럼 사람들이 부르는 조합과 띄어 쓴 단어 모두로 찾는다.
const searchNorm = s => String(s || "").replace(/\s+/g, "").replace(/(아파트|APT|apt)$/i, "").toLowerCase();
const umdStem = u => String(u || "").split(" ").pop().replace(/\d*(동|읍|면|리|가)$/, "");
function searchHit(e, sidoName, raw) {
  const t = searchNorm(raw), name = e[2], sgg = e[3], umd = e[4];
  const cands = [name, umdStem(umd) + name, umd + name, name + umd, sgg + name, sgg + umd + name, sidoName + name];
  if (cands.some(c => searchNorm(c).includes(t))) return true;
  const hay = searchNorm(name + sgg + umd + sidoName);
  const words = String(raw || "").trim().split(/\s+/).map(searchNorm).filter(Boolean);
  return words.length > 1 && words.every(w => hay.includes(w));
}
const qi = $("q"), sug = $("sug");
qi.addEventListener("input", () => {
  const t = searchNorm(qi.value); if (!t) { sug.hidden = true; return; }
  const sname = Object.fromEntries(S.idx.sidos.map(s => [s.sid, short(s.sido)]));
  const hits = S.idx.search.filter(e => searchHit(e, sname[e[0]], qi.value)).sort((a, b) => b[5] - a[5]).slice(0, 12);
  sug.innerHTML = hits.length ? hits.map((e, i) => `<li><button data-i="${i}"><span>${e[2]}</span><small>${sname[e[0]]} ${e[3]} ${e[4]}</small></button></li>`).join("")
    : `<li class="note" style="padding:8px 10px">검색 결과가 없어요. 최근 6개월 거래가 있는 단지만 보여드려요.</li>`;
  sug.hidden = false;
  sug.querySelectorAll("button").forEach(b => b.onclick = () => { const e = hits[+b.dataset.i]; openCx(e[0], e[1], { toMain: true }); sug.hidden = true; qi.value = ""; qi.blur(); });
});
document.addEventListener("click", e => { if (!e.target.closest(".search")) sug.hidden = true; });

// ---------- 탭(휴대폰) ----------
function setTab(t) {
  document.body.dataset.tab = t;
  $("app").classList.toggle("show-region", t === "region");
  document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tab === t));
  if (t === "region") requestAnimationFrame(drawMap);
}
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTab(b.dataset.tab); });

let tm; addEventListener("resize", () => { clearTimeout(tm); tm = setTimeout(drawMap, 120); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawMap);
new MutationObserver(drawMap).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

// ---------- 시작 ----------
(async () => {
  try {
    S.idx = await getJSON(`${DATA}index.json`);
  } catch (e) {
    $("result").innerHTML = `<p class="note">데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</p>`; return;
  }
  const m = S.idx.meta;
  $("asof").textContent = `${ym(m.data_to)} 실거래까지 · 단지 ${m.counts.complexes.toLocaleString("ko-KR")}곳`;
  renderBrands();
  // 사진은 따로 불러와서, 오면 지도와 단지 카드를 다시 그린다
  if (window.Media) window.Media.load(DATA).then(() => { drawMap(); if (S.cur) renderResult(); });
  if (m.validation) $("foot-val").innerHTML = `<b>검증 수준</b> ${m.validation.scope}. ${m.validation.note}`;
  const h = location.hash.match(/^#c-([0-9a-f]+)-(\d+)$/);
  if (h) { await openCx(h[1], +h[2]); return; }
  // 먼저 위치 없이 고른 단지를 바로 보여주고, 위치를 받으면 내 동네 단지로 바꾼다
  const p = window.Geo.pickDefault(S.idx.search, null);
  if (p) await openCx(p.entry.sid, p.entry.id, { auto: true, pick: p });
  if (geoReady()) {
    let state = "prompt";
    try { state = (await navigator.permissions.query({ name: "geolocation" })).state; } catch (e) {}
    if (state !== "denied") locate(false);
  }
})();
})();
