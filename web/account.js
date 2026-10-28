// 간편가입·로그인·회원 유형 선택. 메인 화면과 관리자 화면이 함께 쓴다.
// 화면에 #account-slot 이 있으면 로그인 버튼과 내 정보 메뉴를 그 자리에 그린다.
(() => {
const CFG = window.APP_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BIZ = { agent: "공인중개사", sales_agency: "분양대행사", other: "기타 부동산 사업자" };
const STATUS = { pending: "승인 대기", approved: "승인 완료", rejected: "반려" };
let B = null, S = null, regions = [];
const listeners = [];

// ---------- 모달 뼈대 ----------
const dlg = document.createElement("dialog");
dlg.className = "acc-dlg";
dlg.setAttribute("aria-labelledby", "acc-title");
document.body.appendChild(dlg);
dlg.addEventListener("click", e => { if (e.target === dlg) close(); });
dlg.addEventListener("cancel", e => { if (dlg.dataset.lock === "1") e.preventDefault(); });
function open(html, lock = false) {
  dlg.dataset.lock = lock ? "1" : "";
  dlg.innerHTML = `<div class="acc-box">${lock ? "" : '<button class="acc-x" type="button" aria-label="닫기">×</button>'}${html}</div>`;
  const x = $(".acc-x", dlg); if (x) x.onclick = close;
  if (!dlg.open) dlg.showModal();
}
function close() { dlg.dataset.lock = ""; if (dlg.open) dlg.close(); }
const toast = msg => {
  let t = $(".acc-toast"); if (!t) { t = document.createElement("div"); t.className = "acc-toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 3200);
};

// ---------- 로그인 ----------
const ICONS = {
  kakao: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.5c-5 0-9 3.1-9 7 0 2.5 1.7 4.7 4.2 6l-.9 3.4c-.1.3.3.6.6.4l4-2.6c.4 0 .7.1 1.1.1 5 0 9-3.1 9-7s-4-7.3-9-7.3Z"/></svg>',
  google: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z"/><path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z"/><path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.4 3-4.1 5.6-4.1Z"/></svg>',
};
function openLogin(reason = "") {
  const p = CFG.providers || ["kakao", "google", "email"];
  open(`
    <h2 id="acc-title" class="acc-h">3초 만에 시작하기</h2>
    <p class="acc-sub">${esc(reason || "관심 단지 알림, 호가 비교 기록, 기업회원 광고 신청을 쓸 수 있어요.")}</p>
    <div class="acc-btns">
      ${p.includes("kakao") ? `<button class="acc-sso kakao" data-p="kakao" type="button">${ICONS.kakao}<span>카카오로 시작하기</span></button>` : ""}
      ${p.includes("google") ? `<button class="acc-sso google" data-p="google" type="button">${ICONS.google}<span>Google로 계속하기</span></button>` : ""}
    </div>
    ${p.includes("email") ? `<form class="acc-email" novalidate>
      <label for="acc-email-in">이메일로 시작하기</label>
      <div class="acc-row"><input id="acc-email-in" type="email" autocomplete="email" placeholder="name@example.com" required><button class="acc-btn" type="submit">로그인 링크 받기</button></div>
      <p class="acc-err" id="acc-email-err" hidden></p>
    </form>` : ""}
    <p class="acc-fine">처음이면 자동으로 가입돼요. 기업회원(공인중개사·분양대행사)은 로그인 후 선택할 수 있어요.</p>
    ${B.mode === "demo" ? `<div class="acc-demo"><b>체험 모드</b> 실제 계정이 만들어지지 않고 이 브라우저에만 저장돼요.
      <button class="acc-link" id="acc-demo-admin" type="button">관리자로 체험하기</button></div>` : ""}`);
  dlg.querySelectorAll(".acc-sso").forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await B.signIn(b.dataset.p); } catch (e) { toast(e.message); b.disabled = false; }
  });
  const f = $(".acc-email", dlg);
  if (f) f.onsubmit = async e => {
    e.preventDefault();
    const v = $("#acc-email-in", dlg).value.trim(), err = $("#acc-email-err", dlg);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { err.textContent = "이메일 주소를 확인해 주세요."; err.hidden = false; return; }
    try {
      const r = await B.signInEmail(v);
      if (r.sent) open(`<h2 id="acc-title" class="acc-h">메일을 확인해 주세요</h2><p class="acc-sub"><b>${esc(v)}</b>로 로그인 링크를 보냈어요. 메일의 링크를 누르면 이 화면으로 돌아와 로그인돼요.</p><p class="acc-fine">메일이 안 보이면 스팸함을 확인해 주세요.</p>`);
    } catch (e2) { err.textContent = e2.message; err.hidden = false; }
  };
  const da = $("#acc-demo-admin", dlg);
  if (da) da.onclick = async () => { await B.signInDemoAdmin(); close(); toast("관리자로 로그인했어요"); };
}

// ---------- 온보딩: 회원 유형 ----------
function openOnboard(prefill = null) {
  const p = S.profile, editingBiz = !!prefill;
  const kindFixed = p.kind;
  const step1 = !kindFixed ? `
    <h2 id="acc-title" class="acc-h">어떤 회원으로 가입할까요?</h2>
    <div class="acc-kinds" role="radiogroup" aria-label="회원 유형">
      <label class="acc-kind"><input type="radio" name="kind" value="personal" checked><span><b>일반 회원</b><small>아파트를 사고팔거나 시세를 알아보는 분</small></span></label>
      <label class="acc-kind"><input type="radio" name="kind" value="business"><span><b>기업 회원</b><small>공인중개사, 분양대행사 등 부동산 사업자. 승인 후 광고를 신청할 수 있어요</small></span></label>
    </div>` : `<h2 id="acc-title" class="acc-h">${editingBiz ? "기업 정보 수정" : "가입 정보 입력"}</h2>${editingBiz ? '<p class="acc-sub">정보를 고치면 다시 승인 심사를 거쳐요.</p>' : ""}`;
  const regionOpts = ['<option value="">선택 안 함</option>', ...regions.map(r => `<option ${p.interest_region === r ? "selected" : ""}>${esc(r)}</option>`)].join("");
  const b = prefill || {};
  open(`<form class="acc-form" novalidate>
    ${step1}
    <div class="acc-fields">
      <div class="acc-f"><label for="f-nick">닉네임</label><input id="f-nick" maxlength="30" value="${esc(p.nickname || "")}" required></div>
      <div class="acc-f only-personal"><label for="f-region">관심 지역 <small>(선택)</small></label><select id="f-region">${regionOpts}</select></div>
      <div class="acc-f"><label for="f-phone">휴대폰 <small class="only-personal">(선택)</small></label><input id="f-phone" type="tel" inputmode="tel" maxlength="13" placeholder="010-0000-0000" value="${esc(p.phone || "")}"></div>
      <fieldset class="acc-biz only-business">
        <legend>기업 정보</legend>
        <div class="acc-f"><label for="f-type">업종</label><select id="f-type">${Object.entries(BIZ).map(([k, v]) => `<option value="${k}" ${b.biz_type === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
        <div class="acc-f"><label for="f-company">상호</label><input id="f-company" maxlength="60" value="${esc(b.company || "")}" placeholder="○○공인중개사사무소"></div>
        <div class="acc-f"><label for="f-ceo">대표자</label><input id="f-ceo" maxlength="30" value="${esc(b.ceo || "")}"></div>
        <div class="acc-f"><label for="f-brn">사업자등록번호</label><input id="f-brn" inputmode="numeric" maxlength="12" placeholder="000-00-00000" value="${esc(b.brn ? b.brn.replace(/(\d{3})(\d{2})(\d{5})/, "$1-$2-$3") : "")}"></div>
        <div class="acc-f only-agent"><label for="f-agent">중개사무소 등록번호</label><input id="f-agent" maxlength="30" value="${esc(b.agent_reg_no || "")}" placeholder="시·군·구청에서 받은 등록번호"></div>
        <div class="acc-f"><label for="f-addr">사무소 주소</label><input id="f-addr" maxlength="120" value="${esc(b.office_address || "")}"></div>
        <div class="acc-f"><label for="f-tel">사무소 전화</label><input id="f-tel" type="tel" maxlength="20" value="${esc(b.office_phone || "")}"></div>
      </fieldset>
    </div>
    ${kindFixed ? "" : `<div class="acc-agree">
      <label class="acc-all"><input type="checkbox" id="ag-all"> <b>모두 동의</b></label>
      <label><input type="checkbox" class="ag req" id="ag-14"> 만 14세 이상이에요 <em>필수</em></label>
      <label><input type="checkbox" class="ag req" id="ag-terms"> 이용약관 동의 <em>필수</em> <button type="button" class="acc-link" data-doc="terms">보기</button></label>
      <label><input type="checkbox" class="ag req" id="ag-privacy"> 개인정보 수집·이용 동의 <em>필수</em> <button type="button" class="acc-link" data-doc="privacy">보기</button></label>
      <label><input type="checkbox" class="ag" id="ag-mkt"> 시세 알림·혜택 소식 받기 <em class="opt">선택</em></label>
      <p class="acc-doc" id="acc-doc" hidden></p>
    </div>`}
    <p class="acc-err" id="acc-err" role="alert" hidden></p>
    <button class="acc-btn wide" type="submit">${editingBiz ? "다시 심사 받기" : "가입 완료"}</button>
    ${kindFixed ? "" : '<button class="acc-link center" type="button" id="acc-later">다음에 할게요 (로그아웃)</button>'}
  </form>`, !kindFixed);
  const form = $(".acc-form", dlg);
  const kind = () => kindFixed || form.querySelector("input[name=kind]:checked").value;
  const sync = () => {
    form.dataset.kind = kind();
    form.dataset.agent = $("#f-type", form).value === "agent" ? "1" : "";
  };
  form.addEventListener("change", sync); sync();
  const brn = $("#f-brn", form);
  brn.addEventListener("input", () => { const d = brn.value.replace(/\D/g, "").slice(0, 10); brn.value = d.replace(/^(\d{3})(\d{0,2})(\d{0,5}).*/, (m, a, b2, c) => [a, b2, c].filter(Boolean).join("-")); });
  const all = $("#ag-all", form);
  if (all) {
    all.onchange = () => form.querySelectorAll(".ag").forEach(c => c.checked = all.checked);
    form.querySelectorAll(".ag").forEach(c => c.addEventListener("change", () => { all.checked = [...form.querySelectorAll(".ag")].every(x => x.checked); }));
    const DOCS = { terms: "서비스 이용 조건, 회원의 의무, 시세 신호가 투자 권유가 아니라는 점 등을 담습니다. (출시 전 법률 검토를 거친 전문으로 바꿔 주세요)",
      privacy: "수집 항목: 이메일, 닉네임, 휴대폰(선택), 기업회원은 상호·대표자·사업자등록번호·중개사무소 등록번호·사무소 주소와 전화. 목적: 회원 식별, 기업회원 심사, 광고 계약. 보관: 탈퇴 시까지 (법령상 보관 의무 제외). (출시 전 법률 검토를 거친 전문으로 바꿔 주세요)" };
    form.querySelectorAll("[data-doc]").forEach(b2 => b2.onclick = () => { const d = $("#acc-doc", form); d.textContent = DOCS[b2.dataset.doc]; d.hidden = false; });
  }
  const later = $("#acc-later", form); if (later) later.onclick = async () => { await B.signOut(); close(); };
  form.onsubmit = async e => {
    e.preventDefault();
    const err = $("#acc-err", form), fail = m => { err.textContent = m; err.hidden = false; };
    err.hidden = true;
    const k = kind(), v = id => $(id, form).value.trim();
    if (!v("#f-nick")) return fail("닉네임을 입력해 주세요.");
    if (!kindFixed && !["#ag-14", "#ag-terms", "#ag-privacy"].every(id => $(id, form).checked)) return fail("필수 항목에 동의해 주세요.");
    const phone = v("#f-phone");
    if (phone && !/^0\d{1,2}-?\d{3,4}-?\d{4}$/.test(phone)) return fail("휴대폰 번호 형식을 확인해 주세요.");
    const out = { kind: k, nickname: v("#f-nick"), phone, interest_region: k === "personal" ? v("#f-region") : "", marketing: kindFixed ? p.marketing_opt_in : $("#ag-mkt", form).checked };
    if (k === "business") {
      if (!phone) return fail("기업회원은 담당자 휴대폰 번호가 필요해요.");
      const biz = { biz_type: v("#f-type"), company: v("#f-company"), ceo: v("#f-ceo"), brn: v("#f-brn"), agent_reg_no: v("#f-agent"), office_address: v("#f-addr"), office_phone: v("#f-tel") };
      if (!biz.company) return fail("상호를 입력해 주세요.");
      if (!biz.ceo) return fail("대표자 이름을 입력해 주세요.");
      if (!window.AppUtil.brnValid(biz.brn)) return fail("사업자등록번호가 올바르지 않아요. 숫자 10자리를 다시 확인해 주세요.");
      if (biz.biz_type === "agent" && !biz.agent_reg_no) return fail("공인중개사는 중개사무소 등록번호가 필요해요.");
      if (!biz.office_address) return fail("사무소 주소를 입력해 주세요.");
      if (biz.biz_type !== "agent") biz.agent_reg_no = biz.agent_reg_no || null;
      out.business = biz;
    }
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      await B.saveOnboarding(out);
      if (k === "business") openPending(editingBiz);
      else { close(); toast("가입을 마쳤어요. 반가워요!"); }
    } catch (e2) { fail(e2.message); btn.disabled = false; }
  };
}
function openPending(again) {
  open(`<h2 id="acc-title" class="acc-h">${again ? "다시 심사를 요청했어요" : "기업회원 신청을 받았어요"}</h2>
    <p class="acc-sub">입력하신 사업자 정보를 확인한 뒤 승인해 드려요. 보통 영업일 1~2일 걸려요. 결과는 로그인하면 이 화면 위쪽 내 정보에서 볼 수 있어요.</p>
    <ul class="acc-perks"><li>승인 후 단지 화면·지역 지도에 광고 신청</li><li>상호 옆 '확인된 사업자' 표시</li><li>담당 지역 시세 리포트 (준비 중)</li></ul>
    <button class="acc-btn wide" type="button" id="acc-ok">확인</button>`);
  $("#acc-ok", dlg).onclick = close;
}

// ---------- 내 정보 ----------
function openMe() {
  const { user, profile: p, business: b } = S;
  const kindTxt = p.kind === "business" ? "기업 회원" : p.kind === "personal" ? "일반 회원" : "유형 미선택";
  open(`<h2 id="acc-title" class="acc-h">내 정보</h2>
    <dl class="acc-dl">
      <dt>이메일</dt><dd>${esc(user.email || "-")}</dd>
      <dt>가입 방법</dt><dd>${esc({ kakao: "카카오", google: "Google", email: "이메일" }[user.provider] || user.provider || "-")}</dd>
      <dt>닉네임</dt><dd>${esc(p.nickname)}</dd>
      <dt>회원 유형</dt><dd>${kindTxt}${p.role === "admin" ? " · 관리자" : ""}</dd>
      ${b ? `<dt>기업</dt><dd>${esc(b.company)} · ${BIZ[b.biz_type]}</dd>
      <dt>심사 상태</dt><dd><span class="acc-pill ${b.status}">${STATUS[b.status]}</span>${b.status === "rejected" && b.reject_reason ? `<br><small>사유: ${esc(b.reject_reason)}</small>` : ""}</dd>` : ""}
    </dl>
    <div class="acc-actions">
      ${b ? '<button class="acc-btn ghost" type="button" id="acc-edit-biz">기업 정보 수정</button>' : ""}
      ${b && b.status === "approved" ? `<a class="acc-btn ghost" href="mailto:${esc(CFG.supportEmail || "")}?subject=${encodeURIComponent("광고 신청 - " + b.company)}">광고 신청 메일</a>` : ""}
      ${p.role === "admin" ? '<a class="acc-btn ghost" href="admin.html">관리자 화면</a>' : ""}
      <button class="acc-btn ghost" type="button" id="acc-out">로그아웃</button>
    </div>
    ${b && b.status === "approved" ? `<p class="acc-fine">광고 문의: ${esc(CFG.supportEmail || "")} (메일 앱이 열리지 않으면 이 주소로 보내 주세요)</p>` : ""}`);
  const eb = $("#acc-edit-biz", dlg); if (eb) eb.onclick = () => openOnboard(b);
  $("#acc-out", dlg).onclick = async () => { await B.signOut(); close(); toast("로그아웃했어요"); };
}

// ---------- 헤더 버튼 ----------
function renderSlot() {
  const slot = document.getElementById("account-slot"); if (!slot) return;
  if (!S) { slot.innerHTML = `<button class="acc-top" type="button" id="acc-login">로그인</button>`; $("#acc-login").onclick = () => openLogin(); return; }
  const p = S.profile, b = S.business;
  const badge = b ? `<span class="acc-pill ${b.status}">${b.status === "approved" ? "기업" : STATUS[b.status]}</span>` : p.role === "admin" ? '<span class="acc-pill admin">관리자</span>' : "";
  slot.innerHTML = `<button class="acc-top me" type="button" id="acc-me" aria-label="내 정보"><span class="acc-av" aria-hidden="true">${esc((p.nickname || "?").slice(0, 1))}</span><span class="acc-nm">${esc(p.nickname || "내 정보")}</span>${badge}</button>`;
  $("#acc-me").onclick = openMe;
}

async function refresh(s) {
  S = s === undefined ? await B.session() : s;
  renderSlot();
  if (S && !S.profile?.kind) openOnboard();
  else if (dlg.dataset.lock === "1" && (!S || S.profile?.kind)) close();
  if (S && dlg.open && $("#acc-email-in", dlg)) close();
  listeners.forEach(f => f(S));
}

window.Account = {
  ready: (async () => {
    B = await window.getBackend();
    try { const rj = await fetch("regions.json").then(r => r.ok ? r.json() : null); regions = rj ? rj.regions.filter(r => r.status === "live").map(r => r.label) : []; } catch (e) {}
    B.onAuth(s => refresh(s));
    await refresh();
    return B;
  })(),
  openLogin, onChange: f => listeners.push(f), get session() { return S; }, toast,
};
})();
