"""단지 주변 생활 인프라 수집 (카카오 로컬 API).

  python -m pipeline.infra      # store/complexes.csv 의 단지 중 캐시에 없거나 오래된 곳만 채운다

환경 변수: KAKAO_REST_KEY, MAX_INFRA (1회 실행 주변 시설 최대 단지 수, 기본 3000; 좌표는 단지당 1~2회, 시설은 6회)
캐시: store/infra.json  {단지키: {lat, lng, at, subway, elem, middle, mart, park, hospital_1km, kids_500m}}

출시 전 확인: 카카오 API로 받은 장소 정보를 저장해 서비스에 보여주는 조건(이용약관·운영정책)을 확인할 것.
문제가 되면 이 모듈만 공공 표준데이터(학교 기본정보, 도시철도역사 표준데이터, 병원정보서비스 등)로 바꾸면 된다.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import time
from pathlib import Path

import pandas as pd
import requests

from .collect import STORE

BASE = "https://dapi.kakao.com/v2/local/search"
REFRESH_DAYS = 120


class Kakao:
    def __init__(self, key):
        self.h = {"Authorization": f"KakaoAK {key}"}
        self.calls = 0

    def get(self, path, **params):
        for i in range(4):
            r = requests.get(f"{BASE}/{path}.json", headers=self.h, params=params, timeout=15)
            self.calls += 1
            if r.status_code == 429:
                time.sleep(5 * (i + 1)); continue
            r.raise_for_status()
            return r.json()
        r.raise_for_status()

    def locate(self, row):
        q = f"{row.sido} {row.sgg} {row.umd} {row.jibun}".strip()
        js = self.get("address", query=q)
        if js["documents"]:
            d = js["documents"][0]; return float(d["y"]), float(d["x"])
        js = self.get("keyword", query=f"{row.umd} {row.apt}아파트")
        for d in js["documents"]:
            if "아파트" in d.get("category_name", ""):
                return float(d["y"]), float(d["x"])
        return None

    def nearest(self, docs, ok=lambda d: True):
        for d in docs:
            if ok(d):
                return {"name": d["place_name"], "m": int(d["distance"] or 0)}
        return None

    def around(self, lat, lng):
        c = lambda code, radius, **kw: self.get("category", category_group_code=code, x=lng, y=lat, radius=radius, sort="distance", **kw)
        school = c("SC4", 1500, size=15)["documents"]
        return {
            "subway": self.nearest(c("SW8", 2000)["documents"]),
            "elem": self.nearest(school, lambda d: d["place_name"].endswith("초등학교")),
            "middle": self.nearest(school, lambda d: d["place_name"].endswith("중학교")),
            "mart": self.nearest(c("MT1", 3000)["documents"]),
            "park": self.nearest(self.get("keyword", query="공원", x=lng, y=lat, radius=1500, sort="distance")["documents"],
                                 lambda d: "공원" in d.get("category_name", "")),
            "hospital_1km": c("HP8", 1000, size=1)["meta"]["total_count"],
            "kids_500m": c("PS3", 500, size=1)["meta"]["total_count"],
        }


def run():
    key = os.environ["KAKAO_REST_KEY"].strip()
    limit = int(os.environ.get("MAX_INFRA", 3000))
    # 한 번 실행에 쓰는 시간 상한 (분). 넘으면 저장하고 멈췄다가 다음 실행에서 이어서 채운다
    deadline = time.time() + float(os.environ.get("MAX_INFRA_MIN", 60)) * 60
    over = lambda: time.time() > deadline
    cache_p = STORE / "infra.json"
    cache = json.loads(cache_p.read_text()) if cache_p.exists() else {}
    cx = pd.read_csv(STORE / "complexes.csv", dtype=str).fillna("")
    cx["n"] = pd.to_numeric(cx.get("n", 0), errors="coerce").fillna(0)
    # 화면이 열린 지역(regions.json 의 live) 단지를 먼저 채운다
    live = {s for r in json.loads(Path("regions.json").read_text())["regions"] if r.get("status") == "live" for s in r.get("sidos", [])}
    cx["live"] = cx.cx_key.str.split("|").str[0].isin(live)
    cutoff = (dt.date.today() - dt.timedelta(days=REFRESH_DAYS)).isoformat()
    k = Kakao(key)
    # 1단계: 좌표 먼저 (단지당 1~2회). 위치 기반 첫 화면·가까운 광고가 좌표만 있으면 동작한다
    need_geo = cx[[c not in cache or "lat" not in cache[c] and cache[c].get("geo") != "none" for c in cx.cx_key]].sort_values(["live", "n"], ascending=False)
    print(f"좌표 대상 {len(need_geo):,}곳 (열린 지역 {int(need_geo.live.sum()):,}곳 먼저)")
    try:
        for i, row in enumerate(need_geo.itertuples(), 1):
            if k.calls >= limit * 2 or over():
                break
            loc = k.locate(row)
            rec = cache.get(row.cx_key, {})
            if loc:
                rec.update(lat=round(loc[0], 6), lng=round(loc[1], 6))
            else:
                rec["geo"] = "none"
            cache[row.cx_key] = rec
            if i % 500 == 0:
                cache_p.write_text(json.dumps(cache, ensure_ascii=False)); print(f"  좌표 {i:,}곳, 호출 {k.calls:,}")
        # 2단계: 주변 시설 (단지당 6회). 거래 많은 단지부터, 오래된 것은 다시 확인
        todo = cx[[("lat" in cache.get(c, {})) and cache[c].get("at", "") < cutoff for c in cx.cx_key]].sort_values(["live", "n"], ascending=False).head(limit)
        print(f"주변 시설 대상 {len(todo):,}곳")
        for i, row in enumerate(todo.itertuples(), 1):
            if over():
                print(f"  시간 상한 도달: 시설 {i - 1:,}곳에서 멈춤 (다음 실행에서 이어서)"); break
            rec = cache[row.cx_key]
            rec.update(k.around(rec["lat"], rec["lng"]), at=dt.date.today().isoformat())
            if i % 200 == 0:
                cache_p.write_text(json.dumps(cache, ensure_ascii=False)); print(f"  시설 {i:,}곳, 호출 {k.calls:,}")
    except requests.HTTPError as e:
        print(f"  중단: {e} (다음 실행에서 이어서 채움)")
    cache_p.write_text(json.dumps(cache, ensure_ascii=False))
    print(f"완료: 호출 {k.calls:,}회, 캐시 {len(cache):,}곳")


if __name__ == "__main__":
    run()
