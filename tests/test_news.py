"""뉴스 고르기 규칙 테스트. 실행: python -m tests.test_news"""
from pipeline.news import pick, clean, press_of

ITEMS = [
    {"title": "<b>광주</b> 아파트 매매가 3주 연속 상승", "originallink": "https://www.yna.co.kr/view/1", "pubDate": "Thu, 29 Oct 2026 10:00:00 +0900"},
    {"title": "경기 광주 아파트 분양 흥행", "originallink": "https://www.mk.co.kr/2", "pubDate": "Thu, 29 Oct 2026 11:00:00 +0900"},
    {"title": "서울 집값 또 올라", "originallink": "https://www.hankyung.com/3", "pubDate": "Thu, 29 Oct 2026 12:00:00 +0900"},
    {"title": "광주 아파트 매매가 3주 연속 상승!", "originallink": "https://www.news1.kr/4", "pubDate": "Thu, 29 Oct 2026 09:00:00 +0900"},
    {"title": "전남 순천 신규 분양 &quot;완판&quot;", "originallink": "http://insecure.example/5", "link": "https://n.news.naver.com/5", "pubDate": "Thu, 29 Oct 2026 08:00:00 +0900"},
    {"title": "목포 아파트 거래 늘어", "originallink": "https://www.kwangju.co.kr/6", "pubDate": "Wed, 28 Oct 2026 20:00:00 +0900"},
]
MUST = ["광주", "전남", "목포", "순천"]
EXCL = ["경기 광주"]

assert clean("<b>광주</b> &amp; 전남") == "광주 & 전남"
assert press_of("https://www.yna.co.kr/view/1") == "연합뉴스"
assert press_of("https://news.example.org/a") == "news.example.org"
out = pick(ITEMS, MUST, EXCL)
titles = [x["title"] for x in out]
assert "경기 광주 아파트 분양 흥행" not in titles, "다른 지역(경기 광주) 제외"
assert "서울 집값 또 올라" not in titles, "지역 단어 없는 기사 제외"
assert sum("3주 연속 상승" in t for t in titles) == 1, "같은 제목 중복 제거"
assert all(x["link"].startswith("https://") for x in out), "https 링크만"
assert out == sorted(out, key=lambda x: x["at"], reverse=True), "최신순"
assert out[0]["press"] == "연합뉴스"
assert any("순천" in t for t in titles), "원문 주소가 http 면 네이버 https 주소로 대신"
assert len(out) == 3
print("뉴스 규칙 테스트 통과", len(out), "건")
