// 광고 자리 그리기. Ads.fill(자리키, 요소, {sido, sgg}) 로 부르면 게재 중 광고를 넣고 노출·클릭을 기록한다.
(() => {
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CFG = window.APP_CONFIG || {};
const seen = new Set();
let io = null;
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

async function backend() { return window.getBackend(); }
function watch(el, ad) {
  if (!("IntersectionObserver" in window)) { log(ad, "imp"); return; }
  io = io || new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting && e.intersectionRatio >= .5) { const a = e.target._ad; if (a && !seen.has(e.target._k)) { seen.add(e.target._k); log(a, "imp"); } io.unobserve(e.target); }
  }), { threshold: [.5] });
  el._ad = ad; el._k = ad.id + ":" + Math.random(); io.observe(el);
}
async function log(ad, kind) { try { (await backend()).logEvent(ad.id, kind); } catch (e) {} }
function linkAttrs(ad) {
  return ad.link_url ? `href="${esc(ad.link_url)}" target="_blank" rel="sponsored noopener noreferrer"` : 'href="#" data-house="1"';
}
function bind(el, ad) {
  el.addEventListener("click", e => {
    log(ad, "click");
    if (el.dataset.house === "1") { e.preventDefault(); if (window.Account) window.Account.openLogin("기업회원으로 가입하면 이 자리에 광고를 신청할 수 있어요."); }
  });
}
const label = '<span class="ad-label">광고</span>';
const bg = ad => ad.image_url ? `style="background-image:url('${esc(ad.image_url).replace(/'/g, "%27")}')"` : "";

// ---------- 최상단 배너 (순환) ----------
async function topBanner(host, ctx) {
  let closedAt = 0; try { closedAt = +sessionStorage.getItem("zs_top_closed") || 0; } catch (e) {}
  if (Date.now() - closedAt < 6 * 3600e3) { host.hidden = true; return; }
  const list = (await (await backend()).ads("top_banner", ctx)).slice(0, 5);
  if (!list.length) { host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = `<div class="adtop-in">
    ${list.map((a, i) => `<a class="adtop-slide t-${esc(a.theme || "teal")} ${a.image_url ? "has-img" : ""}" ${linkAttrs(a)} ${bg(a)} data-i="${i}" ${i ? 'hidden' : ""} aria-label="광고: ${esc(a.title)}">
      ${a.image_url ? `<span class="sr">${esc(a.title)} ${esc(a.body || "")}</span>` : `<span class="adtop-txt"><b>${esc(a.title)}</b><span>${esc(a.body || "")}</span></span>${a.cta ? `<span class="adtop-cta">${esc(a.cta)}</span>` : ""}`}
    </a>`).join("")}
    ${label}
    ${list.length > 1 ? `<div class="adtop-dots" role="tablist" aria-label="배너 선택">${list.map((a, i) => `<button type="button" role="tab" aria-label="${i + 1}번째 배너" aria-selected="${!i}" data-i="${i}"></button>`).join("")}</div>` : ""}
    <button class="adtop-x" type="button" aria-label="배너 닫기">×</button>
  </div>`;
  const slides = [...host.querySelectorAll(".adtop-slide")], dots = [...host.querySelectorAll(".adtop-dots button")];
  slides.forEach((s, i) => bind(s, list[i]));
  let cur = 0, timer = null;
  const show = i => {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, j) => s.hidden = j !== cur); dots.forEach((d, j) => d.setAttribute("aria-selected", j === cur));
    watch(slides[cur], list[cur]);
  };
  const start = () => { if (slides.length > 1 && !reduce()) { clearInterval(timer); timer = setInterval(() => show(cur + 1), 6000); } };
  dots.forEach(d => d.onclick = () => { show(+d.dataset.i); start(); });
  host.onmouseenter = () => clearInterval(timer); host.onmouseleave = start;
  host.querySelector(".adtop-x").onclick = () => { host.hidden = true; clearInterval(timer); try { sessionStorage.setItem("zs_top_closed", Date.now()); } catch (e) {} };
  show(0); start();
}

// ---------- 박스 광고 ----------
async function box(slot, host, ctx) {
  const a = (await (await backend()).ads(slot, ctx))[0];
  if (!a) {
    // 비어 있으면 광고 문의 자리로 쓴다
    const H = slot === "side_box"
      ? ["분양 현장을 이 자리에 알리세요", "분양·대행사 전용 자리예요. 현장 주변 단지를 보는 사람에게 먼저 보여줘요."]
      : ["이 자리에 우리 사무소를 알리세요", "지역을 골라 그 동네 아파트를 보는 사람에게 보여줘요. 기업회원 승인 후 신청할 수 있어요."];
    host.innerHTML = `<a class="adbox house" href="#" data-house="1"><span class="adbox-txt"><b>${H[0]}</b><span>${H[1]}</span></span><span class="adbox-cta">기업회원 가입</span></a>`;
    const el = host.firstChild; el.onclick = e => { e.preventDefault(); window.Account && window.Account.openLogin("기업회원으로 가입하면 이 자리에 광고를 신청할 수 있어요."); };
    return;
  }
  host.innerHTML = `<a class="adbox t-${esc(a.theme || "teal")} ${a.image_url ? "has-img" : ""}" ${linkAttrs(a)} aria-label="광고: ${esc(a.title)}">
    ${a.image_url ? `<span class="adbox-img" ${bg(a)}></span>` : ""}
    <span class="adbox-txt">${a._near ? `<em class="adbox-near">${esc(a._near)}</em>` : ""}<b>${esc(a.title)}</b>${a.body ? `<span>${esc(a.body)}</span>` : ""}<small>${esc(a.advertiser_name)}${a.loc_label ? ` · ${esc(a.loc_label)}` : ""}</small></span>
    ${a.cta ? `<span class="adbox-cta">${esc(a.cta)}</span>` : ""}${label}</a>
    ${a.phone ? `<a class="adbox-tel" href="tel:${esc(a.phone)}" data-call="1">분양 상담 ${esc(a.phone)}</a>` : ""}`;
  const el = host.firstChild; bind(el, a); watch(el, a);
  const tel = host.querySelector("[data-call]"); if (tel) tel.addEventListener("click", () => log(a, "call"));
}

// ---------- 매물 문의 (공인중개사 전용) ----------
const initial = n => esc(String(n || "?").trim().slice(0, 1));
function face(a, cls) {
  return a.agent_photo_url
    ? `<img class="${cls}" src="${esc(a.agent_photo_url)}" alt="${esc(a.agent_name)} 공인중개사 사진" loading="lazy">`
    : `<span class="${cls} noimg" aria-hidden="true">${initial(a.agent_name)}</span>`;
}
function contactBtns(a) {
  // 전화 링크는 일부 환경(앱 안 보기 등)에서 열리지 않을 수 있어 번호를 글자로도 보여준다
  return `<a class="ag-btn call" href="tel:${esc(a.phone)}" data-kind="call"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8Z" fill="currentColor"/></svg>전화 ${esc(a.phone)}</a>
    ${a.link_url ? `<a class="ag-btn web" href="${esc(a.link_url)}" target="_blank" rel="sponsored noopener noreferrer" data-kind="web">홈페이지</a>` : ""}`;
}
function bindContact(root, a) {
  root.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", () => log(a, b.dataset.kind)));
}
async function agentBox(host, ctx) {
  const a = (await (await backend()).ads("agent_box", ctx))[0];
  if (!a) {
    host.innerHTML = `<div class="agbox house"><div class="ag-head"><span class="ag-face noimg" aria-hidden="true">?</span><div><b>${esc(ctx.name || "이 단지")} 매물이 궁금하신가요?</b><small>이 동네 공인중개사를 찾고 있어요</small></div></div>
      <button class="ag-btn web" type="button" data-house="1">공인중개사 광고 신청</button></div>`;
    host.querySelector("[data-house]").onclick = () => window.Account && window.Account.openLogin("공인중개사 기업회원으로 가입하면 이 자리에 매물 문의 광고를 신청할 수 있어요.");
    return;
  }
  host.innerHTML = `<div class="agbox" role="group" aria-label="광고: ${esc(a.advertiser_name)} 매물 문의">
    <p class="ag-q">${esc(ctx.name || "이 단지")} 매물이 궁금하다면</p>
    <div class="ag-head">${face(a, "ag-face")}
      <div class="ag-who"><b>${esc(a.agent_name)} <small>공인중개사</small></b>
        <span>${esc(a.advertiser_name)}</span>
        <small class="ag-reg">중개사무소 등록번호 ${esc(a.agent_reg_no)}</small></div>
      ${a._near ? `<em class="ag-near">${esc(a._near)}</em>` : ""}
    </div>
    ${a.body ? `<p class="ag-body">${esc(a.body)}</p>` : ""}
    <div class="ag-btns">${contactBtns(a)}</div>
    ${label}</div>`;
  const el = host.firstElementChild; bindContact(el, a); watch(el, a);
}

// ---------- 목록 안 추천 ----------
async function native(ctx) {
  const a = (await (await backend()).ads("list_native", ctx))[0];
  if (!a) return null;
  const li = document.createElement("li");
  li.className = "adnative-li";
  if (a.category === "agent" && a.agent_name) {
    li.innerHTML = `<div class="adnative agent" role="group" aria-label="광고: ${esc(a.advertiser_name)}">${face(a, "adnative-face")}
      <span class="adnative-txt"><b>${esc(a.title)}</b><small>${esc(a.agent_name)} 공인중개사 · ${esc(a.advertiser_name)}${a._near ? ` · ${esc(a._near)}` : ""}</small></span>
      <a class="ag-btn call sm" href="tel:${esc(a.phone)}" data-kind="call" aria-label="${esc(a.agent_name)} 공인중개사에게 전화 ${esc(a.phone)}">전화</a>${label}</div>`;
    const el = li.firstElementChild; bindContact(el, a); watch(el, a);
    return li;
  }
  li.innerHTML = `<a class="adnative" ${linkAttrs(a)} aria-label="광고: ${esc(a.title)}">
    ${a.image_url ? `<span class="adnative-img" ${bg(a)}></span>` : ""}
    <span class="adnative-txt"><b>${esc(a.title)}</b><small>${esc(a.body || a.advertiser_name)}</small></span>${label}</a>`;
  const el = li.firstChild; bind(el, a); watch(el, a);
  return li;
}

window.Ads = {
  fill(slot, host, ctx = {}) {
    if (!host) return;
    return (slot === "top_banner" ? topBanner(host, ctx) : slot === "agent_box" ? agentBox(host, ctx) : box(slot, host, ctx)).catch(() => { host.hidden = true; });
  },
  native,
};
})();
