// 관리자 화면: 대시보드 · 회원 관리(기업 승인) · 광고 관리(등록·일정·지역·성과)
(() => {
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const n = v => (v ?? 0).toLocaleString("ko-KR");
const pct = (a, b) => b ? (a / b * 100).toFixed(2) + "%" : "–";
const d10 = iso => iso ? new Date(iso).toLocaleDateString("sv-SE") : "";
const BIZ = { agent: "공인중개사", sales_agency: "분양대행사", other: "기타" };
const STATUS = { pending: "승인 대기", approved: "승인 완료", rejected: "반려" };
const PROV = { kakao: "카카오", google: "Google", email: "이메일" };
const CATS = { agent: "공인중개사", sales: "분양·현장", other: "기타" };
const THEMES = { teal: "청록", ink: "남색", sand: "모래", rose: "장미" };
const main = $("#adm-main"), dlg = $("#adm-dlg");
let B = null, tab = "dash", slots = [], idx = null;
const st = { mFilter: "all", mSearch: "", aSlot: "all" };

const adState = a => !a.active ? ["off", "중지"] : new Date(a.starts_at) > new Date() ? ["sched", "예약"] : a.ends_at && new Date(a.ends_at) <= new Date() ? ["ended", "종료"] : ["live", "게재 중"];
const toast = m => window.Account.toast(m);
function openDlg(html) { dlg.innerHTML = `<div class="box">${html}</div>`; if (!dlg.open) dlg.showModal(); }
dlg.addEventListener("click", e => { if (e.target === dlg) dlg.close(); });

// ---------- 접근 확인 ----------
async function gate(s) {
  if (!s) {
    main.innerHTML = `<div class="card adm-gate"><h1>관리자 로그인</h1><p class="hint">관리자 권한이 있는 계정으로 로그인해 주세요.</p>
      <button class="btn primary" id="g-login">로그인</button></div>`;
    $("#g-login").onclick = () => window.Account.openLogin(B.mode === "demo" ? "체험 모드에서는 아래 '관리자로 체험하기'를 누르세요." : "관리자 계정으로 로그인해 주세요.");
    return false;
  }
  if (s.profile?.role !== "admin") {
    main.innerHTML = `<div class="card adm-gate"><h1>관리자 권한이 없어요</h1><p class="hint">${esc(s.user.email || "")} 계정은 관리자가 아니에요. 첫 관리자는 Supabase SQL Editor 에서 지정해요 (README 참고).</p><a class="btn" href="index.html">서비스로 돌아가기</a></div>`;
    return false;
  }
  return true;
}
async function render() {
  const s = window.Account.session;
  if (!(await gate(s))) { $("#nav-pending").hidden = true; return; }
  document.querySelectorAll(".adm-nav button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tab === tab));
  try {
    if (tab === "dash") await dash(); else if (tab === "members") await members(); else if (tab === "photos") await photos(); else await ads();
    const o = await B.overview(7); const np = $("#nav-pending"); np.textContent = o.pending; np.hidden = !o.pending;
  } catch (e) { main.innerHTML = `<div class="card"><p class="form-err">${esc(e.message)}</p></div>`; }
}
document.querySelector(".adm-nav").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; tab = b.dataset.tab; render(); });

// ---------- 대시보드 ----------
async function dash() {
  const [o, list] = await Promise.all([B.overview(7), B.members("pending", "")]);
  main.innerHTML = `<div class="adm-h"><h1>대시보드</h1>${B.mode === "demo" ? '<button class="btn" id="d-reset">체험 데이터 초기화</button>' : ""}</div>
    <div class="kpis">
      <div class="kpi"><small>전체 회원</small><b>${n(o.members)}</b><em>최근 7일 +${n(o.new_7d)}</em></div>
      <div class="kpi"><small>일반 회원</small><b>${n(o.personal)}</b></div>
      <div class="kpi"><small>기업 회원</small><b>${n(o.business)}</b></div>
      <div class="kpi ${o.pending ? "alert" : ""}"><small>기업 승인 대기</small><b>${n(o.pending)}</b></div>
      <div class="kpi"><small>유형 선택 전</small><b>${n(o.onboarding)}</b><em>가입 중 이탈</em></div>
      <div class="kpi"><small>게재 중 광고</small><b>${n(o.live_ads)}</b></div>
      <div class="kpi"><small>광고 노출 · 7일</small><b>${n(o.imp)}</b></div>
      <div class="kpi"><small>광고 클릭 · 7일</small><b>${n(o.click)}</b><em>클릭률 ${pct(o.click, o.imp)}</em></div>
    </div>
    <div class="adm-h"><h1 style="font-size:16px">승인 대기 기업</h1>${list.length ? `<button class="btn" id="d-all">전체 보기</button>` : ""}</div>
    ${memberTable(list.slice(0, 5), true)}`;
  bindMemberRows();
  const all = $("#d-all"); if (all) all.onclick = () => { st.mFilter = "pending"; tab = "members"; render(); };
  const rs = $("#d-reset"); if (rs) rs.onclick = () => { B.reset(); toast("체험 데이터를 처음 상태로 되돌렸어요"); };
}

// ---------- 회원 ----------
function memberTable(list, compact = false) {
  if (!list.length) return `<div class="tbl-wrap"><p class="empty">${compact ? "승인을 기다리는 기업이 없어요." : "조건에 맞는 회원이 없어요."}</p></div>`;
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>가입일</th><th>회원</th><th>유형</th><th>가입 방법</th><th>기업 정보</th><th>심사</th><th></th></tr></thead><tbody>
    ${list.map(m => `<tr>
      <td class="num">${d10(m.created_at)}</td>
      <td>${esc(m.nickname || "-")}${m.role === "admin" ? ' <span class="acc-pill admin">관리자</span>' : ""}<span class="sub">${esc(m.email || "")}</span></td>
      <td>${m.kind === "business" ? "기업" : m.kind === "personal" ? "일반" : '<span class="sub">선택 전</span>'}</td>
      <td>${esc(PROV[m.provider] || m.provider || "-")}</td>
      <td>${m.company ? `${esc(m.company)}<span class="sub">${BIZ[m.biz_type] || ""} · ${esc(m.brn ? m.brn.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3") : "")}</span>` : '<span class="sub">-</span>'}</td>
      <td>${m.status ? `<span class="acc-pill ${m.status}">${STATUS[m.status]}</span>` : ""}</td>
      <td><div class="row-actions">${m.status === "pending" ? `<button class="btn ok" data-approve="${esc(m.id)}">승인</button>` : ""}<button class="btn" data-open="${esc(m.id)}">자세히</button></div></td>
    </tr>`).join("")}</tbody></table></div>`;
}
let memberCache = [];
function bindMemberRows() {
  main.querySelectorAll("[data-approve]").forEach(b => b.onclick = async () => { await B.reviewBusiness(b.dataset.approve, "approved"); toast("승인했어요"); render(); });
  main.querySelectorAll("[data-open]").forEach(b => b.onclick = () => memberDetail(b.dataset.open));
}
async function members() {
  memberCache = await B.members(st.mFilter, st.mSearch);
  const F = { all: "전체", pending: "승인 대기", personal: "일반", business: "기업" };
  main.innerHTML = `<div class="adm-h"><h1>회원 관리</h1></div>
    <div class="tools"><div class="chips" id="m-chips">${Object.entries(F).map(([k, v]) => `<button data-f="${k}" aria-pressed="${st.mFilter === k}">${v}</button>`).join("")}</div>
      <input type="search" id="m-search" placeholder="이메일, 닉네임, 상호 검색" value="${esc(st.mSearch)}" aria-label="회원 검색"></div>
    ${memberTable(memberCache)}
    <p class="hint">기업회원 심사 체크: 사업자등록번호 진위(국세청), 공인중개사는 국가공간정보포털 부동산중개업 조회로 등록번호와 상호가 맞는지 확인하세요.</p>`;
  $("#m-chips").onclick = e => { const b = e.target.closest("button"); if (!b) return; st.mFilter = b.dataset.f; render(); };
  let t; $("#m-search").oninput = e => { clearTimeout(t); t = setTimeout(() => { st.mSearch = e.target.value; render().then(() => { const i = $("#m-search"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 300); };
  bindMemberRows();
}
async function memberDetail(id) {
  const m = memberCache.find(x => x.id === id) || (await B.members("all", "")).find(x => x.id === id);
  const me = window.Account.session.user.id;
  openDlg(`<h2 id="adm-dlg-title">${esc(m.nickname || m.email)}</h2>
    <dl class="detail">
      <dt>이메일</dt><dd>${esc(m.email || "-")}</dd><dt>가입</dt><dd>${d10(m.created_at)} · ${esc(PROV[m.provider] || m.provider || "-")}</dd>
      <dt>유형</dt><dd>${m.kind === "business" ? "기업 회원" : m.kind === "personal" ? "일반 회원" : "선택 전"}</dd>
      <dt>휴대폰</dt><dd>${esc(m.phone || "-")}</dd>
      ${m.company ? `<dt>업종</dt><dd>${BIZ[m.biz_type] || "-"}</dd><dt>상호</dt><dd>${esc(m.company)}</dd><dt>대표자</dt><dd>${esc(m.ceo || "-")}</dd>
      <dt>사업자번호</dt><dd>${esc(m.brn ? m.brn.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3") : "-")} ${window.AppUtil.brnValid(m.brn) ? "· 형식 맞음" : "· 형식 오류"}</dd>
      <dt>중개사무소 등록번호</dt><dd>${esc(m.agent_reg_no || "-")}</dd><dt>사무소</dt><dd>${esc(m.office_address || "-")} · ${esc(m.office_phone || "")}</dd>
      <dt>심사</dt><dd><span class="acc-pill ${m.status}">${STATUS[m.status]}</span>${m.reject_reason ? ` 사유: ${esc(m.reject_reason)}` : ""}</dd>` : ""}
    </dl>
    ${m.company ? `<div class="reject"><label for="rj" class="hint">반려 사유 (반려할 때 회원에게 보여요)</label><textarea id="rj" maxlength="200" placeholder="예: 중개사무소 등록번호와 상호가 일치하지 않아요">${esc(m.reject_reason || "")}</textarea></div>` : ""}
    <p class="form-err" id="md-err" hidden></p>
    <div class="dlg-foot">
      ${m.id !== me ? `<button class="btn" id="md-role">${m.role === "admin" ? "관리자 해제" : "관리자로 지정"}</button>` : "<span></span>"}
      <div class="right">${m.company ? `<button class="btn danger" id="md-reject">반려</button><button class="btn primary" id="md-approve">승인</button>` : ""}<button class="btn" id="md-close">닫기</button></div>
    </div>`);
  const err = $("#md-err", dlg), run = async (f, msg) => { try { await f(); dlg.close(); toast(msg); render(); } catch (e) { err.textContent = e.message; err.hidden = false; } };
  $("#md-close", dlg).onclick = () => dlg.close();
  const ap = $("#md-approve", dlg); if (ap) ap.onclick = () => run(() => B.reviewBusiness(m.id, "approved"), "승인했어요");
  const rj = $("#md-reject", dlg); if (rj) rj.onclick = () => { const r = $("#rj", dlg).value.trim(); if (!r) { err.textContent = "반려 사유를 적어 주세요."; err.hidden = false; return; } run(() => B.reviewBusiness(m.id, "rejected", r), "반려했어요"); };
  const rl = $("#md-role", dlg); if (rl) rl.onclick = () => run(() => B.setRole(m.id, m.role === "admin" ? "user" : "admin"), "권한을 바꿨어요");
}

// ---------- 광고 ----------
async function ads() {
  const [list, stats] = await Promise.all([B.listAds(), B.adStats(30)]);
  const sm = Object.fromEntries(stats.map(s => [s.ad_id, s]));
  const live = k => list.filter(a => a.slot === k && adState(a)[0] === "live").length;
  const shown = list.filter(a => st.aSlot === "all" || a.slot === st.aSlot);
  main.innerHTML = `<div class="adm-h"><h1>광고 관리</h1><button class="btn primary" id="a-new">새 광고 등록</button></div>
    <div class="slotcards">
      <button class="slotcard" data-slot="all" aria-pressed="${st.aSlot === "all"}"><span class="n">${list.filter(a => adState(a)[0] === "live").length}</span><b>전체 자리</b><small>게재 중 광고 수</small></button>
      ${slots.map(s => `<button class="slotcard" data-slot="${s.key}" aria-pressed="${st.aSlot === s.key}"><span class="n">${live(s.key)}</span><b>${esc(s.name)}</b><small>${esc(s.size_hint || "")}</small></button>`).join("")}
    </div>
    ${shown.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>광고</th><th>자리</th><th>상태</th><th>지역·위치</th><th>기간</th><th>노출·30일</th><th>클릭</th><th>전화</th><th>홈페이지</th><th>클릭률</th><th></th></tr></thead><tbody>
      ${shown.map(a => { const [k, t] = adState(a), s = sm[a.id] || {}; return `<tr>
        <td>${a.image_url ? `<span class="thumb" style="background-image:url('${esc(a.image_url).replace(/'/g, "%27")}')"></span>` : `<span class="thumb t-${esc(a.theme || "teal")}">문구</span>`}</td>
        <td>${esc(a.title)}<span class="sub">${esc(a.advertiser_name)}</span></td>
        <td>${esc((slots.find(s2 => s2.key === a.slot) || {}).name || a.slot)}</td>
        <td><span class="st ${k}">${t}</span></td>
        <td>${a.loc_label ? `${esc(a.loc_label)}<span class="sub">${CATS[a.category] || "기타"} · 반경 ${+a.radius_km || 3}km</span>` : a.target_sgg ? esc(a.target_sgg) : a.target_sido ? esc(short(a.target_sido)) : "전국"}</td>
        <td class="num">${d10(a.starts_at)}<span class="sub">~ ${a.ends_at ? d10(a.ends_at) : "종료일 없음"}</span></td>
        <td class="num">${n(s.imp)}</td><td class="num">${n(s.click)}</td><td class="num">${n(s.call)}</td><td class="num">${n(s.web)}</td><td class="num">${pct(s.click, s.imp)}</td>
        <td><div class="row-actions"><button class="btn" data-edit="${a.id}">수정</button><button class="btn" data-toggle="${a.id}">${a.active ? "중지" : "재개"}</button></div></td>
      </tr>`; }).join("")}</tbody></table></div>` : `<div class="tbl-wrap"><p class="empty">이 자리에 등록된 광고가 없어요.</p></div>`}
    <p class="hint">광고가 없는 박스 자리는 '기업회원 가입' 안내로 채워져요. 최상단 배너는 광고가 없으면 숨겨져요.</p>`;
  $("#a-new").onclick = () => adForm(null);
  main.querySelectorAll(".slotcard").forEach(b => b.onclick = () => { st.aSlot = b.dataset.slot; render(); });
  main.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => adForm(list.find(a => a.id === +b.dataset.edit)));
  main.querySelectorAll("[data-toggle]").forEach(b => b.onclick = async () => { const a = list.find(x => x.id === +b.dataset.toggle); await B.saveAd({ ...a, active: !a.active }); toast(a.active ? "광고를 중지했어요" : "광고를 다시 게재해요"); render(); });
}
// 사진은 올리기 전에 줄인다 (긴 변 max px, JPEG). 데모 저장공간과 실제 전송량을 아낀다
async function shrink(file, max = 1600) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 400 * 1024) return file;
    const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.82));
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch (e) { return file; }
}
const short = s => (idx && idx.labels && idx.labels[s]) || (s || "").replace(/(특별자치시|특별자치도|특별시|광역시|도)$/, "");

async function adForm(a) {
  const isNew = !a;
  a = a || { slot: st.aSlot !== "all" ? st.aSlot : "side_box", title: "", body: "", cta: "", image_url: "", link_url: "https://", advertiser_name: "", advertiser_id: null,
    target_sido: null, target_sgg: null, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 30 * 864e5).toISOString(), weight: 1, active: true, theme: "teal" };
  const bizList = (await B.members("business", "")).filter(m => m.status === "approved");
  const sidos = idx ? idx.sidos.map(s => s.sido) : [];
  const sggOf = sd => idx ? idx.regions.filter(r => r.sido === sd).map(r => r.sgg) : [];
  openDlg(`<h2 id="adm-dlg-title">${isNew ? "새 광고 등록" : "광고 수정"}</h2>
    <div class="edit">
      <form class="form" id="af" novalidate>
        <div class="full"><label for="af-slot">광고 자리</label><select id="af-slot">${slots.map(s => `<option value="${s.key}" ${a.slot === s.key ? "selected" : ""}>${esc(s.name)} · ${esc(s.size_hint || "")}</option>`).join("")}</select><p class="hint2" id="af-slot-desc"></p></div>
        <div><label for="af-adv">광고주 이름 (화면에 표시)</label><input id="af-adv" maxlength="60" value="${esc(a.advertiser_name)}"></div>
        <div><label for="af-biz">연결할 기업회원 <small>(선택)</small></label><select id="af-biz"><option value="">연결 안 함</option>${bizList.map(m => `<option value="${esc(m.id)}" data-name="${esc(m.company)}" data-reg="${esc(m.agent_reg_no || "")}" data-ceo="${esc(m.ceo || "")}" data-tel="${esc(m.office_phone || m.phone || "")}" data-type="${esc(m.biz_type || "")}" ${a.advertiser_id === m.id ? "selected" : ""}>${esc(m.company)} · ${BIZ[m.biz_type] || ""}</option>`).join("")}</select></div>
        <div><label for="af-cat">광고 종류</label><select id="af-cat">${Object.entries(CATS).map(([k, t]) => `<option value="${k}" ${(a.category || "other") === k ? "selected" : ""}>${t}</option>`).join("")}</select></div>
        <div><label for="af-radius">노출 반경</label><select id="af-radius">${[1, 3, 5, 10, 30].map(r => `<option value="${r}" ${(+a.radius_km || 3) === r ? "selected" : ""}>${r}km 안 단지</option>`).join("")}</select></div>
        <div class="full"><label for="af-loc">사무소·현장 위치 <small>(가까운 단지를 볼 때 먼저 보여줘요)</small></label>
          <div class="imgrow"><input id="af-loc" list="af-loc-list" placeholder="근처 단지 이름으로 찾기" autocomplete="off"><button class="btn" type="button" id="af-loc-x">위치 빼기</button></div>
          <datalist id="af-loc-list">${(idx && idx.search || []).map(e => `<option value="${esc(e[2] + " · " + e[3] + " " + e[4])}"></option>`).join("")}</datalist>
          <p class="hint2" id="af-loc-state"></p></div>
        <fieldset class="full agent-fields"><legend>공인중개사 정보 <small>(매물 문의 카드에 보여요)</small></legend>
          <div class="agent-grid">
            <div class="ag-photo-col"><span class="ag-face noimg" id="af-face-pv">?</span><label class="btn" for="af-face-file" style="margin:6px 0 0">얼굴 사진</label><input id="af-face-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div>
            <div><label for="af-agent">중개사 이름</label><input id="af-agent" maxlength="20" value="${esc(a.agent_name || "")}"></div>
            <div><label for="af-reg">중개사무소 등록번호</label><input id="af-reg" maxlength="30" value="${esc(a.agent_reg_no || "")}" placeholder="29110-2024-00012"></div>
          </div>
          <p class="hint2">얼굴 사진은 본인 동의를 받은 사진만 올려 주세요. 등록번호는 국가공간정보포털 부동산중개업 조회로 확인해 주세요.</p>
        </fieldset>
        <div><label for="af-phone">전화번호 <small id="af-phone-h">(매물 문의는 필수)</small></label><input id="af-phone" type="tel" maxlength="15" value="${esc(a.phone || "")}" placeholder="062-123-4567"></div>
        <div class="full"><label for="af-title">제목 <small>(최대 60자)</small></label><input id="af-title" maxlength="60" value="${esc(a.title)}"></div>
        <div class="full"><label for="af-body">설명 <small>(최대 120자)</small></label><textarea id="af-body" maxlength="120">${esc(a.body || "")}</textarea></div>
        <div><label for="af-cta">버튼 문구</label><input id="af-cta" maxlength="16" value="${esc(a.cta || "")}" placeholder="자세히 보기"></div>
        <div><label>바탕색 <small>(이미지 없을 때)</small></label><div class="themes">${Object.entries(THEMES).map(([k, v]) => `<label title="${v}"><input type="radio" name="af-theme" value="${k}" ${a.theme === k ? "checked" : ""}><span class="t-${k}"></span></label>`).join("")}</div></div>
        <div class="full"><label for="af-img">이미지 <small>(선택 · 자리별 권장 크기 참고)</small></label>
          <div class="imgrow"><input id="af-img" type="url" placeholder="https://… 또는 파일 올리기" value="${esc(a.image_url && !a.image_url.startsWith("data:") ? a.image_url : "")}"><label class="btn" for="af-file" style="margin:0">파일 올리기</label><input id="af-file" type="file" accept="image/png,image/jpeg,image/webp" hidden><button class="btn" type="button" id="af-img-x">이미지 빼기</button></div>
          <p class="hint2" id="af-img-state">${a.image_url ? (a.image_url.startsWith("data:") ? "올린 이미지 사용 중" : "") : "이미지 없음 · 문구와 바탕색으로 보여줘요"}</p></div>
        <div class="full"><label for="af-link">연결 링크</label><input id="af-link" type="url" value="${esc(a.link_url || "")}" placeholder="https://"><p class="hint2">https:// 로 시작하는 주소만 가능해요. 비우면 누를 때 기업회원 가입 안내가 열려요.</p></div>
        <div><label for="af-sido">노출 지역 · 시도</label><select id="af-sido"><option value="">전국</option>${sidos.map(s => `<option value="${esc(s)}" ${a.target_sido === s ? "selected" : ""}>${esc(short(s))}</option>`).join("")}</select></div>
        <div><label for="af-sgg">시군구</label><select id="af-sgg"></select></div>
        <div><label for="af-start">시작일</label><input id="af-start" type="date" value="${d10(a.starts_at)}"></div>
        <div><label for="af-end">종료일 <small>(비우면 계속)</small></label><input id="af-end" type="date" value="${d10(a.ends_at)}"></div>
        <div><label for="af-weight">노출 비중 (1~10)</label><input id="af-weight" type="number" min="1" max="10" value="${a.weight || 1}"><p class="hint2">같은 자리·지역에 광고가 여럿이면 비중이 클수록 자주 보여요.</p></div>
        <div style="align-self:center"><label class="check"><input type="checkbox" id="af-active" ${a.active ? "checked" : ""}> 게재하기</label></div>
      </form>
      <div class="preview" aria-live="polite"><h3>미리보기</h3><div id="af-pv"></div><p class="hint2">'광고' 표시는 모든 광고에 항상 붙어요 (광고임을 알려야 하므로 끌 수 없어요).</p></div>
    </div>
    <p class="form-err" id="af-err" hidden></p>
    <div class="dlg-foot">${isNew ? "<span></span>" : `<span id="af-del-wrap"><button class="btn danger" type="button" id="af-del">삭제</button></span>`}
      <div class="right"><button class="btn" type="button" id="af-cancel">취소</button><button class="btn primary" type="button" id="af-save">${isNew ? "등록" : "저장"}</button></div></div>`);
  const f = $("#af", dlg), v = id => $(id, dlg).value.trim();
  let img = a.image_url || "", facePhoto = a.agent_photo_url || "";
  const SLOT_CAT = { agent_box: ["agent"], side_box: ["sales"] };
  const syncCat = () => {
    // 자리마다 쓸 수 있는 광고 종류만 남긴다 (매물 문의=공인중개사, 오른쪽 박스=분양·대행사)
    const allow = SLOT_CAT[v("#af-slot")] || Object.keys(CATS), sel = $("#af-cat", dlg), curv = sel.value;
    sel.innerHTML = allow.map(k => `<option value="${k}">${CATS[k]}</option>`).join("");
    sel.value = allow.includes(curv) ? curv : allow[0]; sel.disabled = allow.length === 1;
    const agent = sel.value === "agent";
    $(".agent-fields", dlg).hidden = !agent;
    $("#af-phone-h", dlg).textContent = v("#af-slot") === "agent_box" ? "(매물 문의는 필수)" : "(선택 · 상담 전화)";
  };
  const faceShow = () => { const el = $("#af-face-pv", dlg); el.outerHTML = facePhoto ? `<img class="ag-face" id="af-face-pv" src="${esc(facePhoto)}" alt="">` : `<span class="ag-face noimg" id="af-face-pv">${esc((v("#af-agent") || "?").slice(0, 1))}</span>`; };
  let loc = { lat: a.lat ?? null, lng: a.lng ?? null, loc_label: a.loc_label || null, loc_sgg: a.loc_sgg || null, loc_umd: a.loc_umd || null };
  const locState = () => { $("#af-loc-state", dlg).textContent = loc.loc_label
    ? `${loc.loc_label}${loc.lat != null ? " · 좌표 있음: 거리순으로 노출" : " · 좌표 수집 전: 같은 동네·같은 구 순으로 노출"}`
    : "위치 없음 · 노출 지역 설정만 따라요"; };
  locState();
  const fillSgg = () => { const sd = v("#af-sido"); $("#af-sgg", dlg).innerHTML = `<option value="">${sd ? "시도 전체" : "전국"}</option>` + sggOf(sd).map(g => `<option ${a.target_sgg === g ? "selected" : ""}>${esc(g)}</option>`).join(""); $("#af-sgg", dlg).disabled = !sd; };
  fillSgg();
  const cur = () => ({ ...a, slot: v("#af-slot"), advertiser_name: v("#af-adv"), advertiser_id: v("#af-biz") || null, title: v("#af-title"), body: v("#af-body"), cta: v("#af-cta"),
    theme: (f.querySelector("input[name=af-theme]:checked") || {}).value || "teal", image_url: img, link_url: v("#af-link") === "https://" ? "" : v("#af-link"),
    target_sido: v("#af-sido") || null, target_sgg: v("#af-sido") ? (v("#af-sgg") || null) : null,
    starts_at: v("#af-start") ? new Date(v("#af-start") + "T00:00:00").toISOString() : new Date().toISOString(),
    ends_at: v("#af-end") ? new Date(v("#af-end") + "T23:59:59").toISOString() : null,
    weight: Math.min(10, Math.max(1, parseInt(v("#af-weight"), 10) || 1)), active: $("#af-active", dlg).checked,
    category: v("#af-cat"), radius_km: +v("#af-radius") || 3, ...loc,
    agent_name: v("#af-cat") === "agent" ? v("#af-agent") || null : null, agent_reg_no: v("#af-cat") === "agent" ? v("#af-reg") || null : null,
    agent_photo_url: v("#af-cat") === "agent" ? facePhoto || null : null, phone: v("#af-phone") || null });
  const pv = () => {
    const x = cur(), bg = x.image_url ? `style="background-image:url('${esc(x.image_url).replace(/'/g, "%27")}')"` : "", th = `t-${esc(x.theme)}`;
    $("#af-slot-desc", dlg).textContent = (slots.find(s => s.key === x.slot) || {}).description || "";
    const t = esc(x.title || "제목을 입력하세요"), b = esc(x.body || "");
    const fc = x.agent_photo_url ? `<img class="ag-face" src="${esc(x.agent_photo_url)}" alt="">` : `<span class="ag-face noimg">${esc((x.agent_name || "?").slice(0, 1))}</span>`;
    $("#af-pv", dlg).innerHTML =
      x.slot === "agent_box" ? `<div class="agbox"><p class="ag-q">○○아파트 매물이 궁금하다면</p><div class="ag-head">${fc}<div class="ag-who"><b>${esc(x.agent_name || "중개사 이름")} <small>공인중개사</small></b><span>${esc(x.advertiser_name || "사무소 이름")}</span><small class="ag-reg">중개사무소 등록번호 ${esc(x.agent_reg_no || "-")}</small></div><em class="ag-near">이 단지에서 450m</em></div>${b ? `<p class="ag-body">${b}</p>` : ""}<div class="ag-btns"><span class="ag-btn call">전화 ${esc(x.phone || "번호")}</span>${x.link_url ? '<span class="ag-btn web">홈페이지</span>' : ""}</div><span class="ad-label">광고</span></div>`
      : x.slot === "top_banner" ? `<div class="pv-top adtop"><div class="adtop-in"><span class="adtop-slide ${th} ${x.image_url ? "has-img" : ""}" ${bg}>${x.image_url ? "" : `<span class="adtop-txt"><b>${t}</b><span>${b}</span></span>${x.cta ? `<span class="adtop-cta">${esc(x.cta)}</span>` : ""}`}</span><span class="ad-label">광고</span></div></div>`
      : x.slot === "list_native" ? `<ul class="pv-list"><li class="adnative-li"><span class="adnative">${x.image_url ? `<span class="adnative-img" ${bg}></span>` : ""}<span class="adnative-txt"><b>${t}</b><small>${b || esc(x.advertiser_name)}</small></span><span class="ad-label">광고</span></span></li></ul>`
      : `<div class="pv-box"><span class="adbox ${th} ${x.image_url ? "has-img" : ""}">${x.image_url ? `<span class="adbox-img" ${bg}></span>` : ""}<span class="adbox-txt"><b>${t}</b>${b ? `<span>${b}</span>` : ""}<small>${esc(x.advertiser_name || "광고주")}</small></span>${x.cta ? `<span class="adbox-cta">${esc(x.cta)}</span>` : ""}<span class="ad-label">광고</span></span></div>`;
  };
  f.addEventListener("input", pv); f.addEventListener("change", pv);
  $("#af-slot", dlg).addEventListener("change", () => { syncCat(); pv(); });
  $("#af-cat", dlg).addEventListener("change", () => { syncCat(); pv(); });
  $("#af-agent", dlg).addEventListener("input", () => { if (!facePhoto) faceShow(); });
  $("#af-face-file", dlg).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try { facePhoto = await B.uploadImage(await shrink(file, 480)); faceShow(); pv(); } catch (er) { toast(er.message); }
  };
  $("#af-sido", dlg).onchange = () => { a.target_sgg = null; fillSgg(); pv(); };
  $("#af-biz", dlg).onchange = e => {
    // 기업회원을 고르면 상호·대표자·등록번호·전화를 채운다 (비어 있는 칸만)
    const o = e.target.selectedOptions[0]; if (!o || !o.dataset.name) return pv();
    const fill = (id, val) => { if (val && !v(id)) $(id, dlg).value = val; };
    fill("#af-adv", o.dataset.name); fill("#af-agent", o.dataset.ceo); fill("#af-reg", o.dataset.reg); fill("#af-phone", o.dataset.tel);
    pv();
  };
  $("#af-img", dlg).oninput = e => { img = e.target.value.trim(); $("#af-img-state", dlg).textContent = img ? "" : "이미지 없음 · 문구와 바탕색으로 보여줘요"; pv(); };
  $("#af-img-x", dlg).onclick = () => { img = ""; $("#af-img", dlg).value = ""; $("#af-img-state", dlg).textContent = "이미지 없음 · 문구와 바탕색으로 보여줘요"; pv(); };
  $("#af-file", dlg).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    $("#af-img-state", dlg).textContent = "올리는 중…";
    try { img = await B.uploadImage(await shrink(file, 1600)); $("#af-img", dlg).value = img.startsWith("data:") ? "" : img; $("#af-img-state", dlg).textContent = "올린 이미지 사용 중"; pv(); }
    catch (er) { $("#af-img-state", dlg).textContent = er.message; }
  };
  $("#af-loc", dlg).onchange = e => {
    const val = e.target.value, hit = (idx && idx.search || []).find(x => `${x[2]} · ${x[3]} ${x[4]}` === val);
    if (!hit) { $("#af-loc-state", dlg).textContent = "목록에서 단지를 골라 주세요"; return; }
    loc = { lat: hit[7] ?? null, lng: hit[8] ?? null, loc_label: `${hit[3]} ${hit[4]} (${hit[2]} 근처)`.slice(0, 60), loc_sgg: hit[3], loc_umd: hit[4] };
    e.target.value = ""; locState(); pv();
  };
  $("#af-loc-x", dlg).onclick = () => { loc = { lat: null, lng: null, loc_label: null, loc_sgg: null, loc_umd: null }; locState(); pv(); };
  $("#af-cancel", dlg).onclick = () => dlg.close();
  const err = $("#af-err", dlg);
  $("#af-save", dlg).onclick = async () => {
    const x = cur(), fail = m => { err.textContent = m; err.hidden = false; };
    err.hidden = true;
    if (!x.advertiser_name) return fail("광고주 이름을 입력해 주세요.");
    if (!x.title) return fail("제목을 입력해 주세요.");
    if (x.slot === "agent_box" && (!x.agent_name || !x.agent_reg_no || !x.phone)) return fail("매물 문의 광고는 중개사 이름, 등록번호, 전화번호가 필요해요.");
    if (x.phone && !/^[0-9-]{8,15}$/.test(x.phone)) return fail("전화번호는 숫자와 - 만 써 주세요.");
    if (x.link_url && !/^https:\/\/[^\s]+\.[^\s]+/.test(x.link_url)) return fail("링크는 https:// 로 시작하는 주소여야 해요.");
    if (x.image_url && !x.image_url.startsWith("data:") && !/^https:\/\//.test(x.image_url)) return fail("이미지 주소는 https:// 로 시작해야 해요.");
    if (x.ends_at && new Date(x.ends_at) <= new Date(x.starts_at)) return fail("종료일이 시작일보다 늦어야 해요.");
    try { await B.saveAd(x); dlg.close(); toast(isNew ? "광고를 등록했어요" : "저장했어요"); render(); } catch (e) { fail(e.message); }
  };
  const del = $("#af-del", dlg);
  if (del) del.onclick = () => {
    $("#af-del-wrap", dlg).innerHTML = `<span class="confirm">삭제하면 성과 기록도 함께 지워져요. <button class="btn danger" type="button" id="af-del-yes">삭제</button><button class="btn" type="button" id="af-del-no">취소</button></span>`;
    $("#af-del-yes", dlg).onclick = async () => { try { await B.deleteAd(a.id); dlg.close(); toast("광고를 삭제했어요"); render(); } catch (e) { err.textContent = e.message; err.hidden = false; } };
    $("#af-del-no", dlg).onclick = () => adForm(a);
  };
  syncCat(); faceShow(); pv();
}

// ---------- 사진 ----------
const LICENSES = ["직접 촬영", "촬영자 허락 받음", "공공누리 제1유형", "CC BY", "CC BY-SA"];
const pst = { cx: null };
async function photos() {
  const list = await B.adminPhotos(), act = {};
  for (const p of list) if (p.active) act[`${p.kind}:${p.ref}`] = p;
  const regs = idx ? idx.regions : [];
  const thumb = p => p ? `<span class="thumb" style="background-image:url('${esc(p.url).replace(/'/g, "%27")}')"></span>` : `<span class="thumb t-ink">없음</span>`;
  const cxp = list.filter(p => p.kind === "complex" && p.active);
  const nameOf = key => { const e = (idx?.search || []).find(x => x[9] === key); return e ? `${e[2]} · ${e[3]} ${e[4]}` : key; };
  main.innerHTML = `<div class="adm-h"><h1>사진 관리</h1></div>
    <p class="hint">지도 타일에는 지역 풍경, 단지 카드에는 단지 전경이 들어가요. 올린 사진은 관광공사에서 자동으로 받은 사진보다 먼저 쓰여요. 저작권을 확인한 사진만 올려 주세요.</p>
    <div class="card"><h2>단지 전경 사진</h2>
      <div class="tools"><input id="ph-cx" list="ph-cx-list" placeholder="단지 이름으로 찾기" autocomplete="off" aria-label="단지 찾기" style="max-width:360px">
      <datalist id="ph-cx-list">${(idx?.search || []).map(e => `<option value="${esc(e[2] + " · " + e[3] + " " + e[4])}"></option>`).join("")}</datalist></div>
      <p class="hint2" id="ph-cx-state">단지를 고르면 사진을 올릴 수 있어요. 사진이 없는 단지는 층수와 준공연도로 그린 그림이 보여요.</p>
      ${cxp.length ? `<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th></th><th>단지</th><th>출처</th><th>이용 조건</th><th></th></tr></thead><tbody>
        ${cxp.map(p => `<tr><td>${thumb(p)}</td><td>${esc(nameOf(p.ref))}</td><td>${esc(p.credit)}</td><td>${esc(p.license)}</td><td><button class="btn danger" data-del="${p.id}">내리기</button></td></tr>`).join("")}</tbody></table></div>` : ""}
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>지역 풍경 (지도 타일)</th><th>출처</th><th>이용 조건</th><th></th></tr></thead><tbody>
      ${regs.map(r => { const k = `${r.sido}|${r.sgg}`, p = act["region:" + k] || (window.Media && window.Media.state.region[k]); const own = !!act["region:" + k]; return `<tr>
        <td>${thumb(p)}</td><td>${esc(r.sgg)}<span class="sub">${esc(short(r.sido))} · 단지 ${n(r.complexes)}곳</span></td>
        <td>${p ? esc(p.credit) + (own ? "" : '<span class="sub">관광공사 자동 수집</span>') : '<span class="sub">-</span>'}</td><td>${p ? esc(p.license) : ""}</td>
        <td><div class="row-actions"><button class="btn" data-up-region="${esc(k)}" data-label="${esc(r.sgg)}">${p ? "바꾸기" : "사진 올리기"}</button>${own ? `<button class="btn danger" data-del="${act["region:" + k].id}">내리기</button>` : ""}</div></td></tr>`; }).join("")}
    </tbody></table></div>`;
  main.querySelectorAll("[data-up-region]").forEach(b => b.onclick = () => photoForm("region", b.dataset.upRegion, `${b.dataset.label} 풍경`));
  main.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => { await B.deletePhoto(+b.dataset.del); toast("사진을 내렸어요"); render(); });
  $("#ph-cx").onchange = e => {
    const hit = (idx?.search || []).find(x => `${x[2]} · ${x[3]} ${x[4]}` === e.target.value);
    if (!hit) { $("#ph-cx-state").textContent = "목록에서 단지를 골라 주세요"; return; }
    photoForm("complex", hit[9], `${hit[2]} 전경`);
  };
}
function photoForm(kind, ref, title) {
  openDlg(`<h2 id="adm-dlg-title">${esc(title)} 사진</h2>
    <form class="form" id="pf" novalidate>
      <div class="full"><label for="pf-url">사진</label><div class="imgrow"><input id="pf-url" type="url" placeholder="https://… 또는 파일 올리기"><label class="btn" for="pf-file" style="margin:0">파일 올리기</label><input id="pf-file" type="file" accept="image/png,image/jpeg,image/webp" hidden></div><p class="hint2" id="pf-state"></p></div>
      <div><label for="pf-credit">출처 · 촬영자 <small>(화면에 표시)</small></label><input id="pf-credit" maxlength="80" placeholder="예: 한국관광공사 홍길동"></div>
      <div><label for="pf-lic">이용 조건</label><select id="pf-lic">${LICENSES.map(l => `<option>${l}</option>`).join("")}</select></div>
      <div class="full"><label for="pf-src">원본 주소 <small>(선택)</small></label><input id="pf-src" type="url" placeholder="https://"></div>
      <div class="full"><label class="check"><input type="checkbox" id="pf-ok"> 이 사진을 서비스에 써도 되는 권리를 확인했어요</label></div>
      <div class="full preview"><h3>미리보기 · 화면에서는 서비스 색감에 맞춰 보정돼요</h3><div id="pf-pv" class="pf-pv"></div></div>
    </form>
    <p class="form-err" id="pf-err" hidden></p>
    <div class="dlg-foot"><span></span><div class="right"><button class="btn" type="button" id="pf-cancel">취소</button><button class="btn primary" type="button" id="pf-save">사진 쓰기</button></div></div>`);
  let url = "";
  const pv = () => {
    const u = esc(url).replace(/'/g, "%27");
    $("#pf-pv", dlg).innerHTML = !url ? "" : kind === "region"
      ? `<div class="pf-tiles">${[["#d6333a", "+1.2%"], ["#7b8492", "+0.3%"], ["#2457c5", "-1.4%"]].map(([c, t]) => `<span class="tile has-photo pf-tile" style="background:linear-gradient(180deg, ${c}94, ${c}db), url('${u}') center/cover"><span class="n">${esc(title.replace(/ 풍경$/, ""))}</span><span class="w">${t}</span></span>`).join("")}</div><p class="hint2">오름·보합·내림 색을 덮어서 보여줘요.</p>`
      : `<figure class="hero" style="margin:0;border-radius:12px"><img src="${u}" alt=""><figcaption>사진: ${esc($("#pf-credit", dlg).value || "출처")}</figcaption></figure>`;
  };
  $("#pf-credit", dlg).addEventListener("input", () => kind === "complex" && pv());
  const setUrl = u => { url = u; pv(); };
  $("#pf-url", dlg).oninput = e => setUrl(e.target.value.trim());
  $("#pf-file", dlg).onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    $("#pf-state", dlg).textContent = "올리는 중…";
    try { const u = await B.uploadImage(await shrink(file, 1600)); setUrl(u); $("#pf-state", dlg).textContent = "올린 사진 사용"; $("#pf-url", dlg).value = u.startsWith("data:") ? "" : u; }
    catch (er) { $("#pf-state", dlg).textContent = er.message; }
  };
  $("#pf-cancel", dlg).onclick = () => dlg.close();
  $("#pf-save", dlg).onclick = async () => {
    const err = $("#pf-err", dlg), fail = m => { err.textContent = m; err.hidden = false; };
    if (!url) return fail("사진을 올리거나 주소를 넣어 주세요.");
    if (!/^(https:\/\/|data:image\/)/.test(url)) return fail("사진 주소는 https:// 로 시작해야 해요.");
    if (!$("#pf-credit", dlg).value.trim()) return fail("출처나 촬영자를 적어 주세요.");
    if (!$("#pf-ok", dlg).checked) return fail("사진을 쓸 권리를 확인해 주세요.");
    try {
      await B.savePhoto({ kind, ref, url, credit: $("#pf-credit", dlg).value.trim(), license: $("#pf-lic", dlg).value, source_url: $("#pf-src", dlg).value.trim() || null });
      dlg.close(); toast("사진을 걸었어요"); render();
    } catch (e) { fail(e.message); }
  };
}

// ---------- 시작 ----------
(async () => {
  B = await window.Account.ready;
  $("#adm-mode").textContent = B.mode === "demo" ? "체험 모드 · 이 브라우저에만 저장" : "운영";
  // 지역 페이지마다 데이터가 따로 있어서, 열려 있는 지역의 시도·시군구 목록을 모아 광고 지역 선택에 쓴다
  try {
    const rj = await fetch("regions.json").then(r => r.ok ? r.json() : null);
    const live = rj ? rj.regions.filter(r => r.status === "live") : [];
    const all = await Promise.all(live.map(r => fetch(`data/${r.slug}/index.json`).then(x => x.ok ? x.json() : null).catch(() => null)));
    idx = { sidos: all.filter(Boolean).flatMap(d => d.sidos), regions: all.filter(Boolean).flatMap(d => d.regions), search: all.filter(Boolean).flatMap(d => d.search), labels: Object.fromEntries(live.flatMap(r => r.sidos.map(sd => [sd, r.label]))) };
  } catch (e) {}
  slots = await B.slots();
  if (window.Media && idx) { const rj = await fetch("regions.json").then(r => r.ok ? r.json() : null).catch(() => null); for (const r of (rj?.regions || []).filter(r => r.status === "live")) await window.Media.load(`data/${r.slug}/`); }
  window.Account.onChange(() => render());
  render();
})();
})();
