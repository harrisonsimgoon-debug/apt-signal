"""지역 부동산 뉴스: 네이버 뉴스 검색 API로 지역별 최신 기사 제목을 모은다.

- 크롤링이 아니라 네이버가 공식으로 제공하는 검색 API를 쓴다 (하루 25,000회 무료).
- 제목·언론사·시각·원문 링크만 저장한다. 기사 본문·요약은 저장하지 않는다 (저작권).
- 결과: news/{slug}.json  →  .github/workflows/news.yml 이 news 브랜치에 올린다.

실행: NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=... python -m pipeline.news
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import sys
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

import requests

API = "https://openapi.naver.com/v1/search/news.json"
OUT = Path(os.environ.get("NEWS_DIR", "news"))
KEEP = 30

# 원문 주소 도메인 → 언론사 이름 (없으면 도메인을 그대로 보여준다)
PRESS = {
    "yna.co.kr": "연합뉴스", "newsis.com": "뉴시스", "news1.kr": "뉴스1", "kbc.co.kr": "kbc광주방송", "ikbc.co.kr": "kbc광주방송",
    "kjdaily.com": "광주매일신문", "kwangju.co.kr": "광주일보", "jnilbo.com": "전남일보", "namdonews.com": "남도일보",
    "mdilbo.com": "무등일보", "gjdream.com": "광주드림", "hankyung.com": "한국경제", "mk.co.kr": "매일경제",
    "chosun.com": "조선일보", "joongang.co.kr": "중앙일보", "donga.com": "동아일보", "hani.co.kr": "한겨레",
    "khan.co.kr": "경향신문", "sedaily.com": "서울경제", "edaily.co.kr": "이데일리", "asiae.co.kr": "아시아경제",
    "fnnews.com": "파이낸셜뉴스", "heraldcorp.com": "헤럴드경제", "mt.co.kr": "머니투데이", "kbs.co.kr": "KBS",
    "mbc.co.kr": "MBC", "naver.com": "네이버 뉴스", "kjmbc.co.kr": "광주MBC", "ysmbc.co.kr": "여수MBC", "mpmbc.co.kr": "목포MBC", "sbs.co.kr": "SBS",
}

_TAG = re.compile(r"<[^>]+>")


def clean(t: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub("", t or ""))).strip()


def press_of(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    for dom, name in PRESS.items():
        if host == dom or host.endswith("." + dom):
            return name
    return host


def pick(items: list[dict], must: list[str], exclude: list[str]) -> list[dict]:
    """API 결과 → 화면용 기사. 지역 단어가 제목에 있어야 하고, 다른 지역(예: 경기 광주)은 뺀다. 같은 제목은 하나만."""
    out, seen = [], set()
    for it in items:
        title = clean(it.get("title", ""))
        link = next((u for u in (it.get("originallink"), it.get("link")) if u and u.startswith("https://")), "")
        if not title or not link.startswith("https://"):
            continue
        if must and not any(w in title for w in must):
            continue
        if any(w in title for w in exclude):
            continue
        key = re.sub(r"[^가-힣A-Za-z0-9]", "", title)[:40]
        if key in seen:
            continue
        seen.add(key)
        try:
            at = parsedate_to_datetime(it.get("pubDate", "")).astimezone(dt.timezone.utc)
        except (TypeError, ValueError):
            continue
        out.append({"title": title, "link": link, "press": press_of(link), "at": at.isoformat(timespec="minutes")})
    out.sort(key=lambda x: x["at"], reverse=True)
    return out


def fetch(query: str, cid: str, secret: str) -> list[dict]:
    r = requests.get(API, params={"query": query, "display": 50, "sort": "date"},
                     headers={"X-Naver-Client-Id": cid, "X-Naver-Client-Secret": secret}, timeout=20)
    r.raise_for_status()
    return r.json().get("items", [])


def main() -> int:
    cid, secret = os.environ.get("NAVER_CLIENT_ID", "").strip(), os.environ.get("NAVER_CLIENT_SECRET", "").strip()
    if not cid or not secret:
        print("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 이 없어 뉴스를 건너뜁니다.")
        return 0
    regions = json.loads(Path("regions.json").read_text())["regions"]
    OUT.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="minutes")
    for reg in regions:
        cfg = reg.get("news")
        if reg.get("status") != "live" or not cfg:
            continue
        raw = []
        for q in cfg["queries"]:
            try:
                raw += fetch(q, cid, secret)
            except requests.RequestException as e:
                print(f"  {reg['label']} '{q}' 실패: {e}")
        items = pick(raw, cfg.get("must", []), cfg.get("exclude", []))[:KEEP]
        (OUT / f"{reg['slug']}.json").write_text(json.dumps({"region": reg["label"], "updated": now, "items": items},
                                                            ensure_ascii=False, indent=1))
        print(f"  {reg['label']}: 기사 {len(items)}건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
