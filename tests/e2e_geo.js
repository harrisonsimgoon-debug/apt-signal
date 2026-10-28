// 위치 기반 첫 화면 + 가까운 중개사 광고 테스트 (가짜 좌표 site_geo 사용)
// python3 tests/make_geo_fixture.py && (cd site_geo && python3 -m http.server 8766) & node tests/e2e_geo.js
const { chromium } = require("playwright");
const fs = require("fs");
const G = require("../web/geo.js");
const BASE = process.env.BASE || "http://127.0.0.1:8766/";
const D3 = process.env.D3_LOCAL || "/opt/npm-tools/node_modules/d3/dist/d3.min.js";
let fails = 0;
const ok = (c, m) => { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; };
(async () => {
  const idx = JSON.parse(fs.readFileSync("site_geo/data/jeonnam-gwangju/index.json"));
  // 서구 화정동의 거래 적은 단지 옆에 서 있다고 가정
  const here = idx.search.filter(e => e[3] === "서구" && e[4] === "화정동").sort((a, b) => a[5] - b[5])[0];
  const expect = G.pickDefault(idx.search, { lat: here[7], lng: here[8] });
  const browser = await chromium.launch();
  const mk = async (geo) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, ...(geo ? { geolocation: geo, permissions: ["geolocation"] } : {}) });
    await ctx.route(/cdnjs\.cloudflare\.com\/.*d3/, r => r.fulfill({ path: D3, contentType: "application/javascript" }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    return ctx;
  };
  const errors = [];
  // 1. 위치 허용
  let ctx = await mk({ latitude: here[7], longitude: here[8] });
  let page = await ctx.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE + "jeonnam-gwangju.html");
  await page.waitForFunction(() => /내 위치 근처/.test(document.getElementById("pick")?.textContent || ""), null, { timeout: 8000 });
  const name = await page.textContent("#result .apt");
  ok(name === expect.entry.name, `내 위치(${here[2]} 옆) → ${expect.area}에서 점수 최고 단지: ${name}`);
  ok(expect.entry.n6 >= 3, `고른 단지 거래 ${expect.entry.n6}건 (3건 이상)`);
  const pick = await page.textContent("#pick");
  ok(pick.includes(expect.area), `안내 문구에 동네 이름: ${pick.slice(0, 40)}…`);
  await page.waitForSelector("#ad-agent .agbox");
  const near = await page.textContent("#ad-agent");
  ok(near.includes("화정동") && near.includes("같은 동네"), "매물 문의: 같은 동네 공인중개사");
  await page.screenshot({ path: process.argv[2] ? `${process.argv[2]}/geo-pc.png` : "geo-pc.png" });
  // 사용자가 다른 단지를 고르면 위치로 덮어쓰지 않음
  await page.fill("#q", "그랜드센트럴"); await page.click("#sug button");
  await page.waitForTimeout(400);
  ok((await page.textContent("#result .apt")).includes("그랜드센트럴") && !(await page.isVisible("#pick")), "직접 고른 단지는 그대로, 자동 선택 안내는 사라짐");
  await page.waitForTimeout(300);
  const near2 = await page.textContent("#ad-agent");
  ok(near2.includes("계림동") && !near2.includes("화정동"), "단지를 바꾸면 매물 문의도 그 단지 동네 중개사로 바뀜");
  await ctx.close();
  // 2. 위치 거부
  ctx = await mk(null);
  page = await ctx.newPage(); page.on("pageerror", e => errors.push(e.message));
  await page.goto(BASE + "jeonnam-gwangju.html");
  await page.waitForSelector("#pick");
  const fb = G.pickDefault(idx.search, null);
  ok((await page.textContent("#result .apt")) === fb.entry.name, `위치 없음 → ${fb.area}(거래 최다)에서 점수 최고: ${fb.entry.name}`);
  ok(await page.isVisible("#pick-locate"), "위치 없을 때 '내 위치로 찾기' 버튼");
  await ctx.close();
  ok(errors.length === 0, "스크립트 오류 없음" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close();
  console.log(fails ? `실패 ${fails}건` : "위치 화면 테스트 통과");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
