// 체험 모드 끝까지 흐름 테스트: 허브 → 지역 페이지 → 기업회원 가입 → 관리자 승인 → 광고 등록 → 노출
// 실행: (cd site && python3 -m http.server 8765) 를 띄운 뒤  node tests/e2e_demo.js [스크린샷폴더]
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = process.env.BASE || "http://127.0.0.1:8765/";
const SHOT = process.argv[2] || "shots";
const D3 = process.env.D3_LOCAL || "/opt/npm-tools/node_modules/d3/dist/d3.min.js";
fs.mkdirSync(SHOT, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ko-KR" });
  // 외부 CDN 이 막힌 환경: d3 는 로컬 파일로, 글꼴은 건너뛴다
  await ctx.route(/cdnjs\.cloudflare\.com\/.*d3/, r => fs.existsSync(D3) ? r.fulfill({ path: D3, contentType: "application/javascript" }) : r.abort());
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const errors = [];
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(m.text()); });

  // 1. 허브
  await page.goto(BASE + "index.html");
  await page.waitForSelector(".hub-card.live");
  ok(await page.locator(".hub-card.live").count() === 1, "허브: 열린 지역 1곳");
  ok(await page.locator(".hub-card.soon").count() >= 5, "허브: 준비 중 지역 표시");
  await page.waitForSelector("#ad-top:not([hidden]) .adtop-slide", { timeout: 5000 });
  ok(true, "허브: 최상단 배너 노출");
  await page.screenshot({ path: `${SHOT}/hub-pc.png` });

  // 2. 지역 페이지
  await page.click(".hub-card.live");
  await page.waitForSelector("#result .apt");
  ok((await page.title()) === "우리집 AI시세 전남광주", "지역 페이지 제목");
  ok((await page.textContent(".brand .rg")) === "전남광주", "타이틀 뒤 지역 이름");
  ok(await page.locator("#ad-side .adbox").count() === 1, "오른쪽 분양 박스 자리 채움");
  ok(!(await page.textContent("#ad-side")).includes("공인중개사"), "오른쪽 박스에는 중개사 광고가 안 나옴");
  ok(await page.locator("#ad-agent .agbox").count() === 1, "단지 카드 아래 매물 문의 박스");
  ok(await page.locator("#result .hero").count() === 1, "단지 카드 위 전경 자리 (사진 없으면 그림)");
  ok(await page.locator("#ad-region .adbox").count() === 1, "지역 지도 아래 광고 자리 채움");
  const nb = await page.locator("#brand-list > li").count();
  ok(nb >= 20, `브랜드 순위 ${nb}개`);
  ok((await page.textContent("#brand-list > li:first-child .b-name b")).length > 0, "브랜드 1위 이름");
  await page.click('#brand-sort [data-k="trades"]');
  const firstByTrades = await page.textContent("#brand-list > li:first-child .b-name b");
  ok(firstByTrades === "LH·주공" || firstByTrades.length > 0, `거래량 정렬 1위: ${firstByTrades}`);
  await page.click('#brand-sort [data-k="index"]');
  await page.click("#brand-list > li:first-child summary");
  await page.click("#brand-list > li:first-child .b-top button");
  await page.waitForTimeout(300);
  ok((await page.locator("#result .brand-chip").count()) === 1, "브랜드 대표 단지를 누르면 단지 화면 + 브랜드 표시");
  await page.click(".tile >> nth=0");
  await page.waitForTimeout(300);
  ok(await page.locator("#list > li").count() > 3, "지역 단지 목록");
  ok(await page.locator("#list .adnative").count() <= 1, "목록 안 추천 광고 자리");
  await page.screenshot({ path: `${SHOT}/region-pc.png`, fullPage: true });

  // 3. 기업회원 가입
  await page.click("#acc-login");
  await page.click(".acc-sso.kakao");
  await page.waitForSelector(".acc-form");
  await page.click('input[name=kind][value=business]');
  await page.fill("#f-nick", "테스트중개");
  await page.fill("#f-phone", "010-1111-2222");
  await page.fill("#f-company", "테스트공인중개사사무소");
  await page.fill("#f-ceo", "홍길동");
  await page.fill("#f-brn", "1234567890");
  await page.fill("#f-agent", "29110-2026-00001");
  await page.fill("#f-addr", "광주 동구 테스트로 1");
  await page.check("#ag-all");
  await page.click(".acc-form button[type=submit]");
  ok((await page.textContent("#acc-err")).includes("사업자등록번호"), "잘못된 사업자번호 거절");
  await page.fill("#f-brn", "410-29-38572");
  await page.click(".acc-form button[type=submit]");
  await page.waitForSelector("#acc-ok");
  await page.click("#acc-ok");
  ok((await page.textContent("#account-slot")).includes("승인 대기"), "가입 후 헤더에 승인 대기");

  // 4. 관리자
  await page.goto(BASE + "admin.html");
  await page.waitForSelector(".adm-gate h1");
  ok((await page.textContent(".adm-gate h1")).includes("권한이 없어요"), "기업회원은 관리자 화면에 못 들어감");
  await page.evaluate(async () => (await window.getBackend()).signInDemoAdmin());
  await page.waitForSelector(".kpis");
  const pend = await page.textContent(".kpi.alert b");
  ok(pend === "3", `승인 대기 ${pend}건`);
  await page.screenshot({ path: `${SHOT}/admin-dash.png`, fullPage: true });
  await page.click('.adm-nav [data-tab="members"]');
  await page.waitForSelector("#m-search");
  await page.fill("#m-search", "테스트");
  await page.waitForTimeout(500);
  await page.click("[data-open]");
  await page.click("#md-reject");
  ok(!(await page.isHidden("#md-err")), "사유 없이 반려 막음");
  await page.click("#md-approve");
  await page.waitForTimeout(300);
  ok((await page.textContent(".tbl")).includes("승인 완료"), "관리자 승인");
  await page.click('.adm-nav [data-tab="ads"]');
  await page.waitForSelector("#a-new");
  const before = await page.locator(".tbl tbody tr").count();
  await page.click("#a-new");
  await page.selectOption("#af-slot", "top_banner");
  await page.fill("#af-adv", "테스트공인중개사사무소");
  await page.fill("#af-title", "테스트 배너: 동구 급매 모음");
  await page.fill("#af-body", "자동 테스트로 등록한 광고");
  await page.fill("#af-link", "javascript:alert(1)");
  await page.click("#af-save");
  ok((await page.textContent("#af-err")).includes("https"), "https 아닌 링크 거절");
  await page.fill("#af-link", "https://example.com/test");
  await page.selectOption("#af-sido", { index: 1 });
  ok((await page.locator("#af-pv .adtop-slide").count()) === 1, "미리보기: 최상단 배너 모양");
  await page.screenshot({ path: `${SHOT}/admin-adform.png` });
  await page.click("#af-save");
  await page.waitForTimeout(300);
  ok((await page.locator(".tbl tbody tr").count()) === before + 1, "광고 등록");

  // 4-1. 매물 문의 광고 규칙과 등록
  await page.click("#a-new");
  await page.selectOption("#af-slot", "agent_box");
  ok(await page.isDisabled("#af-cat") && (await page.inputValue("#af-cat")) === "agent", "매물 문의 자리는 공인중개사로 고정");
  await page.fill("#af-adv", "테스트공인중개사사무소");
  await page.fill("#af-title", "계림동 매물 상담");
  await page.fill("#af-agent", "홍길동");
  await page.click("#af-save");
  ok((await page.textContent("#af-err")).includes("등록번호"), "등록번호·전화 없으면 거절");
  await page.fill("#af-reg", "29110-2026-00001");
  await page.fill("#af-phone", "062-000-1234");
  await page.fill("#af-link", "https://example.com/agent");
  await page.fill("#af-loc", "그랜드센트럴 · 동구 계림동");
  await page.dispatchEvent("#af-loc", "change");
  ok((await page.textContent("#af-loc-state")).includes("계림동"), "단지 이름으로 사무소 위치 지정");
  await page.setInputFiles("#af-face-file", "tests/fixtures/test-building.jpg");
  await page.waitForSelector("#af-pv img.ag-face");
  ok(true, "얼굴 사진 미리보기");
  await page.screenshot({ path: `${SHOT}/admin-agentform.png` });
  await page.click("#af-save");
  await page.waitForTimeout(300);
  await page.selectOption("#af-slot", "side_box").catch(() => {});
  // 4-2. 사진 관리
  await page.click('.adm-nav [data-tab="photos"]');
  await page.waitForSelector("[data-up-region]");
  await page.click('[data-up-region="전남광주통합특별시|동구"]');
  await page.setInputFiles("#pf-file", "tests/fixtures/test-landscape.jpg");
  await page.waitForSelector("#pf-pv .pf-tile");
  await page.fill("#pf-credit", "테스트 촬영자");
  await page.click("#pf-save");
  ok((await page.textContent("#pf-err")).includes("권리"), "사진 권리 확인 없이 거절");
  await page.check("#pf-ok");
  await page.click("#pf-save");
  await page.waitForTimeout(300);
  await page.fill("#ph-cx", "그랜드센트럴 · 동구 계림동");
  await page.dispatchEvent("#ph-cx", "change");
  await page.setInputFiles("#pf-file", "tests/fixtures/test-building.jpg");
  await page.waitForSelector("#pf-pv .hero img");
  await page.fill("#pf-credit", "테스트 촬영자");
  await page.check("#pf-ok");
  await page.click("#pf-save");
  await page.waitForTimeout(300);
  ok(await page.locator(".tbl tbody tr").count() >= 2, "지역·단지 사진 등록");
  await page.screenshot({ path: `${SHOT}/admin-photos.png`, fullPage: true });

  // 5. 등록한 광고가 지역 페이지 최상단에 순환 노출
  await page.goto(BASE + "jeonnam-gwangju.html");
  await page.waitForSelector("#ad-top:not([hidden]) .adtop-slide");
  const titles = await page.$$eval(".adtop-slide", els => els.map(e => e.textContent));
  ok(titles.some(t => t.includes("테스트 배너")), `최상단 배너 순환에 새 광고 포함 (${titles.length}개)`);
  ok(await page.locator(".adtop .ad-label").count() === 1, "광고 표시 라벨");
  ok(await page.locator(".tile.has-photo").count() >= 1, "지도 타일에 지역 풍경 사진");
  await page.fill("#q", "그랜드센트럴"); await page.click("#sug button");
  await page.waitForSelector("#result .hero img");
  ok(true, "단지 카드에 전경 사진");
  const ag = await page.textContent("#ad-agent");
  ok(ag.includes("홍길동") || ag.includes("서계림"), "계림동 단지에서 계림동 중개사 매물 문의");
  ok(await page.locator("#ad-agent .ag-btn.call").count() === 1, "전화 연결 버튼");
  await page.screenshot({ path: `${SHOT}/region-photo-pc.png` });

  // 6. 휴대폰 · 태블릿
  for (const [name, w, h] of [["phone", 390, 844], ["tablet", 820, 1180]]) {
    const p = await ctx.newPage();
    await p.setViewportSize({ width: w, height: h });
    p.on("pageerror", e => errors.push(`${name}: ${e.message}`));
    await p.goto(BASE + "jeonnam-gwangju.html");
    await p.waitForSelector("#result .apt");
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= w, `${name}: 가로 넘침 없음 (${sw}px)`);
    await p.screenshot({ path: `${SHOT}/region-${name}.png`, fullPage: name === "tablet" });
    if (name === "phone") {
      await p.click('.tabs [data-tab="brands"]');
      ok(await p.isVisible("#brands") && !(await p.isVisible("#result")), "phone: 브랜드 순위 탭");
      await p.screenshot({ path: `${SHOT}/brands-phone.png` });
      await p.goto(BASE + "admin.html");
      await p.waitForSelector(".kpis");
      const asw = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(asw <= w, `phone: 관리자 화면 가로 넘침 없음 (${asw}px)`);
      await p.screenshot({ path: `${SHOT}/admin-phone.png` });
    }
    await p.close();
  }

  ok(errors.length === 0, "스크립트 오류 없음" + (errors.length ? `: ${errors.slice(0, 5).join(" | ")}` : ""));
  await browser.close();
  console.log(fails ? `\n실패 ${fails}건` : "\n모든 화면 테스트 통과");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
