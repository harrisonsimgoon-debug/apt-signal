"""저장소의 실거래 → 정제 → 점수 → 화면용 JSON(site/data).

  python -m pipeline.build [--months 14]

출력
  site/data/{지역}/index.json      지역 요약(시군구 흐름), 검색 색인, 브랜드 순위, 검증 수치
  site/data/{지역}/c/{시도ID}.json  시도별 단지 상세(점수, 근거 수치, 시세 흐름, 호가 판단용 최근 거래, 인프라)
  지역 목록은 regions.json
  store/complexes.csv       인프라 수집 대상 목록
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from .clean import clean_sales, clean_rents, region_index, BAND_LABELS, month_label
from .collect import STORE
from .scoring import features, score
from .brands import brand_of, ranking

SITE = Path("site/data")


def read_raw(kind, months):
    """원천 파일 읽기. 같은 지역·같은 달을 API와 직접 받은 파일이 모두 가지고 있으면 API 쪽만 쓴다.

    실거래 자료에는 같은 조건의 거래가 정당하게 여러 건 있을 수 있어(해제 후 재계약 등) 행 단위 중복 제거는 하지 않는다.
    """
    files = sorted((STORE / "raw" / kind).glob("*/*.csv.gz"))
    all_yms = sorted({f.parent.name for f in files})
    if not all_yms:
        return pd.DataFrame()
    # 폴더 개수가 아니라 달력 기준으로 최근 N개월 (과거 자료가 중간에 비어 있어도 오래된 달이 끼어들지 않게)
    y, m = int(all_yms[-1][:4]), int(all_yms[-1][4:])
    t = y * 12 + m - 1 - (months - 1)
    cutoff = f"{t // 12}{t % 12 + 1:02d}"
    yms = [ym for ym in all_yms if ym >= cutoff]
    files = [f for f in files if f.parent.name in yms]
    if not files:
        return pd.DataFrame()
    reg_p = STORE / "regions.csv"
    code_name = {}
    if reg_p.exists():
        r = pd.read_csv(reg_p, dtype=str)
        code_name = {c: "file_" + f"{a}_{b}".replace(" ", "_") for c, a, b in zip(r.code, r.sido, r.sgg)}
    api_cover = {(f.parent.name, code_name.get(f.stem.split(".")[0])) for f in files if not f.name.startswith("file_")}
    files = [f for f in files if not (f.name.startswith("file_") and (f.parent.name, f.name.split(".")[0]) in api_cover)]
    frames = []
    for f in files:
        try:
            frames.append(pd.read_csv(f, dtype={"jibun": str, "apt_seq": str, "umd": str}))
        except pd.errors.EmptyDataError:
            continue  # 그 달 거래가 0건이라 빈 파일인 경우
    frames = [d for d in frames if not d.empty and "ymd" in d]
    if not frames:
        return pd.DataFrame()
    df = pd.concat(frames, ignore_index=True)
    df["ymd"] = pd.to_datetime(df.ymd, errors="coerce")
    for c in ("sido", "sgg", "umd", "jibun", "apt"):
        df[c] = df[c].fillna("").astype(str).str.strip()
    if kind == "sale":
        df["cancelled"] = df.cancelled.astype(str).str.lower().isin(["true", "1"])
        df["direct"] = df.direct.astype(str).str.lower().isin(["true", "1"])
    return df.dropna(subset=["ymd"])


def last_complete_month(sales, settle_days=20):
    """신고 기한이 30일이라 월말 후 20일이 지난 달까지를 '거의 다 들어온 달'로 본다(그 이후 들어오는 건은 소수)."""
    latest = sales.ymd.max()
    m = latest.year * 12 + latest.month - 1
    while True:
        end = pd.Timestamp(year=m // 12, month=m % 12 + 1, day=1) + pd.offsets.MonthEnd(0)
        if end + pd.Timedelta(days=settle_days) <= latest:
            return m
        m -= 1


def sid(name):
    return hashlib.md5(name.encode()).hexdigest()[:8]


def load_regions():
    return [r for r in json.loads(Path("regions.json").read_text(encoding="utf-8"))["regions"]]


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--months", type=int, default=14)
    a = ap.parse_args(argv)
    raw = read_raw("sale", a.months)
    sales = clean_sales(raw)
    rents = clean_rents(read_raw("rent", a.months))
    L = last_complete_month(sales)
    sales = sales[sales.m <= L]
    print(f"매매 {len(raw):,} → {len(sales):,}건, 전세 {len(rents):,}건, 기준 {month_label(L)}")

    f = score(features(sales, rents, L))
    infra = json.loads((STORE / "infra.json").read_text()) if (STORE / "infra.json").exists() else {}
    validation = json.loads(Path("validation.json").read_text()) if Path("validation.json").exists() else None

    s = sales[~sales.outlier]
    idx = region_index(sales.assign(sgg=sales.sido + "|" + sales.sgg)).set_index(["sgg", "m"]).idx  # 동구·남구처럼 시군구 이름이 겹쳐서 시도와 묶음
    mb = s.groupby(["cx", "band"]).size().reset_index(name="n").sort_values("n").drop_duplicates("cx", keep="last").set_index("cx").band
    months = list(range(L - 11, L + 1))
    groups = {k: g for k, g in s[s.cx.isin(f.index)].groupby("cx")}
    # 평당가(최근 12개월, 주력 평형) 와 같은 시군구 중위 대비 위치 → 브랜드 지수에 쓴다
    py = {}
    for cx in f.index:
        t = groups[cx]; tb = t[(t.band == mb[cx]) & (t.m > L - 12)]
        py[cx] = float((tb.price / tb.area).median() * 3.3058) if len(tb) else np.nan
    f["py"] = pd.Series(py)
    f["py_rel"] = np.log(f.py / f.groupby(["sido", "sgg"]).py.transform("median"))

    live = [r for r in load_regions() if r["status"] == "live"]
    for reg in live:
        out = SITE / reg["slug"]
        (out / "c").mkdir(parents=True, exist_ok=True)
        fr = f[f.sido.isin(reg["sidos"])]
        if fr.empty:
            print(f"  {reg['label']}: 데이터 없음 (sidos 이름 확인)"); continue
        search, sidos, regions = [], [], []
        for sido, g in fr.groupby("sido"):
            jq = [round(float(g.jeonse.quantile(q)) * 100, 1) if g.jeonse.notna().any() else None for q in (.3, .5, .7)]
            rows = []
            for cx, r in g.iterrows():
                t = groups[cx]; b = int(mb[cx]); tb = t[t.band == b]
                area = float(tb.area.median())
                ser = tb.groupby("m").price.median().reindex(months)
                rec = tb[tb.m > L - 12]
                rk = f"{r.sido}|{r.sgg}"
                now_i = idx.get((rk, L), np.nan)
                if np.isnan(now_i):
                    adj = rec.price.values
                else:
                    adj = rec.price.values * np.exp(now_i - np.array([idx.get((rk, m), now_i) for m in rec.m]))
                inf = infra.get(r.cx_key, {})
                rows.append({
                    # key: 빌드가 바뀌어도 같은 단지를 가리키는 고정 키 (사진·관심 단지 등 외부 기록 연결용)
                    "id": int(cx), "key": hashlib.md5(r.cx_key.encode()).hexdigest()[:12], "maxfl": None if t.floor.isna().all() else int(t.floor.max()), "name": r.apt, "sgg": r.sgg, "umd": r.umd,
                    "built": None if pd.isna(r.built) else int(r.built),
                    "brand": brand_of(r.apt),
                    "score": int(r.score), "lv": r.lv, "n1": int(r.n1), "n2": int(r.n2),
                    "py": None if pd.isna(r.py) else int(round(r.py)),
                    "reg_mom": None if pd.isna(r.reg_mom) else round(float(np.expm1(r.reg_mom) * 100), 2),
                    "jeonse": None if pd.isna(r.jeonse) else round(float(r.jeonse) * 100, 1),
                    "w": {k[2:]: float(r[k]) for k in r.index if k.startswith("w_")},
                    "band": BAND_LABELS[b], "area": round(area, 1),
                    "series": [None if pd.isna(v) else int(v) for v in ser.values],
                    "adj": [int(v) for v in adj[-30:]], "peak": int(tb.price.max()),
                    "peak_m": f"{tb.loc[tb.price.idxmax()].ymd:%Y.%m}",
                    "infra": {k: v for k, v in inf.items() if k not in ("at", "lat", "lng")} or None,
                    "lat": inf.get("lat"), "lng": inf.get("lng"),
                })
                # 검색 색인: [시도ID, 단지ID, 이름, 시군구, 읍면동, 6개월 거래, 점수, 위도, 경도, 고정키] — 위치 기반 첫 화면에도 쓴다
                search.append([sid(sido), int(cx), r.apt, r.sgg, r.umd, int(r.n1 + r.n2), int(r.score), inf.get("lat"), inf.get("lng"), rows[-1]["key"]])
            (out / "c" / f"{sid(sido)}.json").write_text(json.dumps({"sido": sido, "jeonse_q": jq, "cx": rows}, ensure_ascii=False, separators=(",", ":")))
            for sgg, h in g.groupby("sgg"):
                m = h.reg_mom.dropna()
                mv = None if m.empty else round(float(np.expm1(m.iloc[0]) * 100), 2)
                regions.append({"sido": sido, "sid": sid(sido), "sgg": sgg, "trades": int(h.n2.sum()), "complexes": int(len(h)),
                                "mom": mv, "lv": "flat" if mv is None else ("up" if mv > 1 else "down" if mv < -1 else "flat"),
                                "jeonse": None if h.jeonse.isna().all() else round(float(h.jeonse.median() * 100))})
            sidos.append({"sido": sido, "sid": sid(sido), "complexes": int(len(g)), "trades": int(g.n2.sum())})
        bdf = pd.DataFrame({"id": fr.index, "name": fr.apt.values, "sgg": fr.sgg.values, "umd": fr.umd.values, "score": fr.score.values,
                            "n6": (fr.n1 + fr.n2).values, "py": fr.py.values, "py_rel": fr.py_rel.values, "built": fr.built.values})
        brands = ranking(bdf)
        geo = sum(1 for e in search if e[7] is not None)
        meta = {"region": {k: reg[k] for k in ("slug", "label")}, "geo_cover": round(geo / max(len(search), 1) * 100), "data_to": month_label(L), "months": [month_label(m) for m in months],
                "validation": validation, "counts": {"complexes": int(len(fr)), "trades6": int((fr.n1 + fr.n2).sum())},
                "brand_cover": round(float(bdf.name.map(brand_of).notna().mean()) * 100)}
        (out / "index.json").write_text(json.dumps({"meta": meta, "sidos": sidos, "regions": regions, "search": search, "brands": brands},
                                                   ensure_ascii=False, separators=(",", ":")))
        # 지역 풍경 사진 (pipeline.media 가 모은 것) 중 이 지역 것만
        mp = STORE / "media.json"
        allm = json.loads(mp.read_text()).get("region", {}) if mp.exists() else {}
        mine = {k: v for k, v in allm.items() if v and k.split("|")[0] in reg["sidos"]}
        (out / "media.json").write_text(json.dumps({"region": mine, "complex": {}}, ensure_ascii=False))
        print(f"  {reg['label']} ({reg['slug']}): 단지 {len(fr):,}곳, 브랜드 순위 {len(brands)}개")
    f.assign(n=f.n1 + f.n2)[["cx_key", "sido", "sgg", "umd", "jibun", "apt", "n"]].to_csv(STORE / "complexes.csv", index=False)
    print(f"완료: 단지 {len(f):,}곳, 지역 페이지 {len(live)}개 → {SITE}")


if __name__ == "__main__":
    main()
