// 위치 규칙 단위 테스트: node tests/test_geo.js
const G = require("../web/geo.js");
let fails = 0;
const ok = (c, m) => { console.log((c ? "통과: " : "실패: ") + m); if (!c) fails++; };
// [시도ID, 단지ID, 이름, 시군구, 읍면동, 6개월 거래, 점수, 위도, 경도]
const S = [
  ["s", 1, "가까운단지", "동구", "계림동", 2, 90, 35.1500, 126.9200],   // 가장 가깝지만 거래 2건 → 후보 제외
  ["s", 2, "계림최고", "동구", "계림동", 5, 70, 35.1520, 126.9220],
  ["s", 3, "계림보통", "동구", "계림동", 9, 55, 35.1530, 126.9230],
  ["s", 4, "산수동단지", "동구", "산수동", 20, 85, 35.1600, 126.9300],
  ["s", 5, "광산대단지", "광산구", "수완동", 80, 60, 35.1900, 126.8200],
  ["s", 6, "광산최고", "광산구", "신가동", 30, 75, 35.1800, 126.8100],
  ["s", 7, "읍내단지", "화순군", "화순읍 신기리", 1, 95, 35.0600, 126.9900],
  ["s", 8, "읍다른리", "화순군", "화순읍 광덕리", 6, 66, 35.0650, 126.9950],
  ["s", 9, "좌표없음", "남구", "봉선동", 50, 99, null, null],
];
let p = G.pickDefault(S, { lat: 35.1500, lng: 126.9200 });
ok(p.how === "location" && p.entry.id === 2 && p.area === "계림동", "가장 작은 동네에서 거래 3건 이상 중 점수 최고 (계림최고)");
ok(p.nearest === "가까운단지", "가장 가까운 단지 이름도 알려줌");
p = G.pickDefault(S, { lat: 35.0600, lng: 126.9900 });
ok(p.entry.id === 8 && p.area === "화순읍", "리 단위에 후보가 없으면 읍 단위로 넓힘");
p = G.pickDefault(S, { lat: 37.5665, lng: 126.9780 });
ok(p.how === "far", "지역 밖 위치는 대체 규칙");
p = G.pickDefault(S, null);
ok(p.how === "busiest" && p.area === "광산구" && p.entry.id === 6, "위치 없으면 거래 많은 시군구의 점수 최고 단지");

const now = new Date("2026-10-28T03:00:00Z");
const base = { active: true, starts_at: "2026-10-01T00:00:00Z", ends_at: null, weight: 1, target_sido: "광주" };
const ads = [
  { ...base, id: 1, category: "agent", lat: 35.1525, lng: 126.9225, radius_km: 3 },          // 약 0.05km
  { ...base, id: 2, category: "agent", lat: 35.1700, lng: 126.9400, radius_km: 3 },          // 약 2.6km
  { ...base, id: 3, category: "agent", lat: 35.2500, lng: 126.9200, radius_km: 3 },          // 약 11km → 반경 밖
  { ...base, id: 4, category: "other", weight: 10 },                                          // 위치 없는 시도 광고, 비중 최대
  { ...base, id: 5, category: "agent", loc_sgg: "동구", loc_umd: "계림동", weight: 10 },      // 좌표 없음, 같은 동네
  { ...base, id: 6, category: "sales", lat: 35.1526, lng: 126.9226, radius_km: 3, weight: 10 }, // 아주 가깝지만 분양
];
let pass = true;
for (let i = 0; i < 200; i++) {
  const r = G.rankAds(ads, { sido: "광주", sgg: "동구", umd: "계림동", lat: 35.1520, lng: 126.9220 }, now);
  if (r[0].id !== 1 || r.some(a => a.id === 3) || r.at(-1).id !== 4) { pass = false; break; }
}
ok(pass, "가장 가까운 공인중개사가 먼저, 반경 밖은 제외, 위치 없는 광고는 비중이 커도 뒤로 (200번 반복)");
const r1 = G.rankAds(ads, { sido: "광주", sgg: "동구", umd: "계림동", lat: 35.1520, lng: 126.9220 }, now);
ok(/m$/.test(r1[0]._near), `거리 표시: ${r1[0]._near}`);
const r2 = G.rankAds(ads, { sido: "광주", sgg: "동구", umd: "계림동" }, now);
ok(r2[0].id === 5 && r2[0]._near === "같은 동네", "단지 좌표가 없으면 같은 동네 사무소가 먼저");
ok(G.rankAds([{ ...base, id: 9, active: false }], { sido: "광주" }, now).length === 0, "중지된 광고 제외");
console.log(fails ? `실패 ${fails}건` : "위치 규칙 테스트 통과");
process.exit(fails ? 1 : 0);
