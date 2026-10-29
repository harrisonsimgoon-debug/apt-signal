"""지역 풍경 사진 자동 수집 (한국관광공사 관광사진 정보 API, 공공데이터포털).

  python -m pipeline.media        # 사진이 없는 시군구만 채운다 (store/media.json)

환경 변수: DATA_GO_KR_KEY. 공공데이터포털에서 '한국관광공사_관광사진 정보' 활용신청이 따로 필요하다.
출시 전 확인: 관광공사 사진의 이용 조건(출처 표시 등)을 활용신청 화면에서 확인하고, 화면 출처 문구(credit, license)를 맞춘다.
관리자가 올린 사진(Supabase photos 테이블)이 있으면 화면에서 그쪽을 먼저 쓴다.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import pandas as pd
import requests

from .collect import STORE

API = "https://apis.data.go.kr/B551011/PhotoGalleryService1/gallerySearchList1"
METRO = ("특별시", "광역시", "통합특별시")


def keyword(sido: str, sgg: str) -> str:
    # 광역시의 동구·남구처럼 이름이 겹치는 구는 도시 이름을 붙인다
    base = sgg.split()[0]
    if sido.endswith(METRO) and base.endswith("구"):
        city = "광주" if sido.startswith("전남광주") else sido.replace("특별시", "").replace("광역시", "")
        return f"{city} {base}"
    return base[:-1] if base.endswith(("시", "군")) and len(base) > 2 else base


def search(key: str, kw: str):
    r = requests.get(API, params={"serviceKey": key, "numOfRows": 20, "pageNo": 1, "MobileOS": "ETC", "MobileApp": "apt-signal",
                                  "arrange": "C", "keyword": kw, "_type": "json"}, timeout=20)
    r.raise_for_status()
    body = r.json().get("response", {}).get("body", {})
    items = body.get("items") or {}
    items = items.get("item", []) if isinstance(items, dict) else []
    return items if isinstance(items, list) else [items]


def pick(items):
    # 사람 얼굴이 주인공인 사진보다 풍경을 고른다: 제목·키워드에 풍경 단어가 있는 것 우선
    good = ("풍경", "전경", "야경", "공원", "호수", "바다", "해변", "산", "강", "섬", "다리", "항")
    items = [i for i in items if (i.get("galWebImageUrl") or "").startswith("http")]
    items.sort(key=lambda i: -sum(w in (i.get("galTitle", "") + i.get("galSearchKeyword", "")) for w in good))
    return items[0] if items else None


def run():
    key = os.environ["DATA_GO_KR_KEY"].strip()
    p = STORE / "media.json"
    media = json.loads(p.read_text()) if p.exists() else {"region": {}}
    cx = pd.read_csv(STORE / "complexes.csv", dtype=str)
    pairs = cx[["sido", "sgg"]].drop_duplicates().itertuples(index=False)
    n = 0
    for sido, sgg in pairs:
        ref = f"{sido}|{sgg}"
        if ref in media["region"]:
            continue
        try:
            it = pick(search(key, keyword(sido, sgg)))
        except requests.HTTPError as e:
            print(f"  중단: {e}"); break
        if not it:
            media["region"][ref] = None; continue
        url = it["galWebImageUrl"].replace("http://", "https://")
        media["region"][ref] = {"url": url, "credit": f"한국관광공사 {it.get('galPhotographer', '').strip()}".strip(),
                                "license": "한국관광공사 제공", "title": it.get("galTitle", ""), "source_url": None}
        n += 1
    p.write_text(json.dumps(media, ensure_ascii=False, indent=1))
    print(f"지역 사진 {n}곳 새로 채움 (전체 {sum(1 for v in media['region'].values() if v)}곳)")


if __name__ == "__main__":
    run()
