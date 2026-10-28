// 위치 규칙 모음: 첫 화면 단지 고르기, 가까운 광고 고르기. 브라우저(window.Geo)와 Node 테스트에서 함께 쓴다.
(function (root) {
const R = 6371;
function km(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const has = (lat, lng) => typeof lat === "number" && typeof lng === "number";
const MIN_TRADES = 3;      // 최근 6개월 거래가 이보다 적은 단지는 첫 화면 후보에서 뺀다 (점수 신뢰도)
const FAR_KM = 15;         // 가장 가까운 단지가 이보다 멀면 이 지역 밖에 있다고 본다

// 검색 색인 한 줄: [시도ID, 단지ID, 이름, 시군구, 읍면동, 6개월 거래, 점수, 위도, 경도]
const E = e => ({ sid: e[0], id: e[1], name: e[2], sgg: e[3], umd: e[4], n6: e[5], score: e[6], lat: e[7], lng: e[8] });

function topIn(list, test) {
  const c = list.filter(x => test(x) && x.n6 >= MIN_TRADES);
  c.sort((a, b) => b.score - a.score || b.n6 - a.n6);
  return c[0] || null;
}

// 첫 화면 단지. pos = {lat, lng} 또는 null
function pickDefault(search, pos) {
  const L = search.map(E);
  if (pos && has(pos.lat, pos.lng)) {
    let near = null, best = Infinity;
    for (const x of L) if (has(x.lat, x.lng)) { const d = km(pos.lat, pos.lng, x.lat, x.lng); if (d < best) { best = d; near = x; } }
    if (near && best <= FAR_KM) {
      const eup = near.umd.split(" ")[0];
      const levels = [
        [near.umd, x => x.sgg === near.sgg && x.umd === near.umd],                 // 가장 작은 단위 (동, 리)
        [eup, x => x.sgg === near.sgg && x.umd.split(" ")[0] === eup],             // 읍·면
        [near.sgg, x => x.sgg === near.sgg],                                       // 시군구
      ];
      for (const [label, test] of levels) {
        const t = topIn(L, test);
        if (t) return { entry: t, how: "location", area: label, nearest: near.name, km: best };
      }
    }
    if (near && best > FAR_KM) {
      const fb = pickDefault(search, null);
      return fb && { ...fb, how: "far", km: best };
    }
  }
  // 위치가 없으면: 최근 거래가 가장 많은 시군구에서 점수 최고 단지
  const vol = {};
  for (const x of L) vol[x.sgg] = (vol[x.sgg] || 0) + x.n6;
  const busy = Object.keys(vol).sort((a, b) => vol[b] - vol[a]);
  for (const sgg of busy) { const t = topIn(L, x => x.sgg === sgg); if (t) return { entry: t, how: "busiest", area: sgg }; }
  return L.length ? { entry: L[0], how: "any", area: L[0].sgg } : null;
}

// 광고 고르기. ctx = {sido, sgg, umd, lat, lng}. 반환: 게재 순서대로, 각 광고에 _km, _near(표시 문구)
function rankAds(list, ctx, now = new Date()) {
  const live = a => a.active && new Date(a.starts_at) <= now && (!a.ends_at || new Date(a.ends_at) > now);
  const target = a => (!a.target_sido || a.target_sido === ctx.sido) && (!a.target_sgg || a.target_sgg === ctx.sgg);
  const out = [];
  for (const a of list) {
    if (!live(a) || !target(a)) continue;
    let tier, dist = null, near = "";
    const located = has(a.lat, a.lng) || a.loc_sgg;
    if (has(a.lat, a.lng) && has(ctx.lat, ctx.lng)) {
      dist = km(ctx.lat, ctx.lng, a.lat, a.lng);
      if (dist > (+a.radius_km || 3)) continue;                    // 노출 반경 밖
      tier = dist <= 1 ? 6 : dist <= 3 ? 5 : 4;
      near = dist < 1 ? `이 단지에서 ${Math.max(50, Math.round(dist * 1000 / 50) * 50)}m` : `이 단지에서 ${dist.toFixed(1)}km`;
    } else if (located) {
      if (a.loc_sgg === ctx.sgg && a.loc_umd && a.loc_umd === ctx.umd) { tier = 5; near = "같은 동네"; }
      else if (a.loc_sgg === ctx.sgg) { tier = 4; near = `같은 ${ctx.sgg}`; }
      else tier = 1;                                                // 다른 동네 사무소: 더 나은 광고가 없을 때만
    } else {
      tier = a.target_sgg ? 3 : a.target_sido ? 2 : 1;
    }
    const agentBonus = a.category === "agent" && tier >= 4 ? 50 : 0;  // 가까운 거리대 안에서는 공인중개사 먼저
    out.push({ a: { ...a, _km: dist, _near: near }, k: tier * 100 + agentBonus + Math.random() * (a.weight || 1) * 4.9 });
  }
  return out.sort((x, y) => y.k - x.k).map(x => x.a);
}

const Geo = { km, pickDefault, rankAds, MIN_TRADES, FAR_KM };
if (typeof module !== "undefined" && module.exports) module.exports = Geo;
else root.Geo = Geo;
})(typeof window !== "undefined" ? window : globalThis);
