"""단지명 → 아파트 브랜드, 브랜드 종합지수.

브랜드 사전은 위에서부터 먼저 맞는 것을 쓴다(구체적인 이름을 앞에).
새 지역을 열면 그 지역 단지명에서 자주 나오는 이름을 확인해 아래에 추가한다:
  python -m pipeline.brands unmatched data/jeonnam-gwangju  # 브랜드를 못 찾은 이름 중 자주 나오는 말
"""
from __future__ import annotations

import collections
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# (표시 이름, 찾을 말들, 회사)  ─ 찾을 말은 띄어쓰기 없이 비교한다
BRANDS = [
    ("힐스테이트", ["힐스테이트"], "현대건설"),
    ("래미안", ["래미안"], "삼성물산"),
    ("자이", ["자이"], "GS건설"),
    ("푸르지오", ["푸르지오"], "대우건설"),
    ("롯데캐슬", ["롯데캐슬"], "롯데건설"),
    ("e편한세상", ["e편한세상", "편한세상"], "DL이앤씨"),
    ("아이파크", ["아이파크"], "HDC현대산업개발"),
    ("더샵", ["더샵"], "포스코이앤씨"),
    ("SK뷰", ["sk뷰", "에스케이뷰", "skview"], "SK에코플랜트"),
    ("포레나", ["포레나"], "한화건설"),
    ("호반써밋·베르디움", ["호반써밋", "호반베르디움", "호반리젠시빌", "호반"], "호반건설"),
    ("중흥S-클래스", ["중흥s-클래스", "중흥s클래스", "중흥에스클래스", "중흥에스-클래스", "중흥"], "중흥건설"),
    ("제일풍경채", ["제일풍경채", "풍경채"], "제일건설"),
    ("우미린", ["우미린", "우미"], "우미건설"),
    ("대광로제비앙", ["대광로제비앙", "로제비앙"], "대광건영"),
    ("한국아델리움", ["한국아델리움", "아델리움"], "한국건설"),
    ("모아엘가", ["모아엘가", "모아미래도", "모아"], "모아주택산업"),
    ("영무예다음", ["영무예다음", "예다음"], "영무건설"),
    ("골드클래스", ["골드클래스"], "골드건설"),
    ("남양휴튼", ["남양휴튼", "휴튼"], "남양건설"),
    ("대주 피오레·파크빌", ["대주피오레", "대주파크빌", "대주"], "대주건설"),
    ("양우내안애", ["양우내안애", "내안애"], "양우건설"),
    ("진아리채", ["진아리채"], "진아건설"),
    ("서희스타힐스", ["서희스타힐스"], "서희건설"),
    ("우방아이유쉘", ["우방아이유쉘", "아이유쉘"], "우방"),
    ("대방 노블랜드·디에트르", ["대방노블랜드", "대방디에트르", "디에트르", "노블랜드"], "대방건설"),
    ("한양수자인", ["한양수자인", "수자인"], "한양"),
    ("코아루", ["코아루"], "한국토지신탁"),
    ("금호어울림", ["금호어울림", "어울림"], "금호건설"),
    ("한신더휴", ["한신더휴", "더휴"], "한신공영"),
    ("두산위브", ["두산위브", "위브"], "두산건설"),
    ("데시앙", ["데시앙"], "태영건설"),
    ("부영 사랑으로", ["사랑으로", "부영"], "부영주택"),
    ("LH·주공", ["휴먼시아", "주공", "lh"], "한국토지주택공사"),
    ("라인", ["라인동산", "라인캐슬", "첨단라인", "라인"], "라인건설"),
]


def norm(s: str) -> str:
    return re.sub(r"\s+", "", str(s)).lower()


def brand_of(name: str):
    n = norm(name)
    for label, keys, co in BRANDS:
        if any(k in n for k in keys):
            return label
    return None


def company_of(label: str) -> str:
    return next((co for l, _, co in BRANDS if l == label), "")


def ranking(cx: pd.DataFrame, min_complexes=3, min_trades=10) -> list[dict]:
    """cx 열: id, name, sgg, umd, score, n6, py(평당가 만원), py_rel(같은 시군구 중위 대비 log 비율), built"""
    d = cx.assign(brand=cx.name.map(brand_of)).dropna(subset=["brand"])
    rows = []
    for b, g in d.groupby("brand"):
        w = g.n6.clip(lower=1)
        prem = g.py_rel.dropna()
        rows.append({
            "brand": b, "company": company_of(b), "complexes": int(len(g)), "trades": int(g.n6.sum()),
            "premium": float(np.average(prem, weights=w[prem.index])) if len(prem) else np.nan,
            "score": float(np.average(g.score, weights=w)),
            "py": float(np.average(g.py.dropna(), weights=w[g.py.dropna().index])) if g.py.notna().any() else np.nan,
            "liq": float(np.log1p(g.n6.sum() / len(g))),
            "new_share": float((g.built >= 2016).mean()) if g.built.notna().any() else 0.0,
            "top": g.sort_values(["score", "n6"], ascending=False).head(5)[["id", "name", "sgg", "umd", "score", "n6"]].to_dict("records"),
        })
    r = pd.DataFrame(rows)
    if r.empty:
        return []
    r = r[(r.complexes >= min_complexes) & (r.trades >= min_trades)].copy()
    r["raw_premium"], r["raw_score"] = r.premium, r.score
    if r.empty:
        return []
    z = lambda s: ((s - s.mean()) / s.std()).fillna(0) if s.std() > 0 else s * 0
    # 단지가 적은 브랜드는 평균 쪽으로 당겨서, 단지 2~3곳의 우연한 값으로 1위가 되지 않게 한다
    K = 4
    shrink = lambda col: (r[col] * r.complexes + r[col].mean() * K) / (r.complexes + K)
    r["premium"], r["score"] = shrink("premium"), shrink("score")
    # 종합지수: 가격 프리미엄 45%, AI 시세 점수 35%, 거래 활발도 20%
    c = 0.45 * z(r.premium) + 0.35 * z(r.score) + 0.20 * z(r.liq)
    c = c / c.std() if c.std() > 0 else c
    r["index"] = (50 + 15 * c).clip(5, 95).round(1)
    r = r.sort_values("index", ascending=False)
    r["rank"] = range(1, len(r) + 1)
    out = []
    for x in r.itertuples():
        out.append({"rank": int(x.rank), "brand": x.brand, "company": x.company, "index": float(x.index),
                    "premium": None if pd.isna(x.raw_premium) else round(float(np.expm1(x.raw_premium) * 100), 1),
                    "score": round(float(x.raw_score), 1), "py": None if pd.isna(x.py) else int(round(x.py)),
                    "trades": int(x.trades), "complexes": int(x.complexes), "new_share": round(float(x.new_share) * 100),
                    "top": [{**t, "id": int(t["id"]), "score": int(t["score"]), "n6": int(t["n6"])} for t in x.top]})
    return out


def unmatched(data_dir: str, top=80):
    files = sorted(Path(data_dir, "c").glob("*.json"))
    names = [c["name"] for f in files for c in json.loads(f.read_text())["cx"]]
    rest = [n for n in names if not brand_of(n)]
    cnt = collections.Counter()
    for n in rest:
        t = re.sub(r"[\d()\-.·,]+", " ", n)
        for L in (2, 3, 4, 5):
            for i in range(len(t) - L + 1):
                s = t[i:i + L]
                if " " not in s:
                    cnt[s] += 1
    print(f"브랜드 없음 {len(rest):,} / {len(names):,}")
    print(" | ".join(f"{k} {v}" for k, v in cnt.most_common(top)))


if __name__ == "__main__":
    if sys.argv[1:2] == ["unmatched"]:
        unmatched(sys.argv[2])
