"""1년치 데이터용 단일 분할 신호 검증.

기간을 겹치지 않게 나눈다(같은 거래가 신호와 결과 양쪽에 들어가면 가짜 상관이 생김).
  M1: 신호 앞 구간, M2: 신호 뒤 구간  → 단지 가격 흐름, 거래량 변화
  B : 결과 기준 구간, F: 결과 구간    → 결과 = F 중위 평당가 / B 중위 평당가 - 1
시장 전체 방향은 한 번뿐이라 검증 불가. 여기서 보는 것은 '같은 시기에 어떤 단지가 더 올랐나'(순위 능력).
"""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from .clean import month_label


def m_of(s):  # '2025-11' -> month index
    y, m = map(int, s.split("-")); return y * 12 + m - 1


def cb_med(s, a, b):
    g = s[(s.m >= a) & (s.m <= b)].groupby("cb").lu
    return pd.DataFrame({"med": g.median(), "n": g.size()})


def change(cur, prev, cb_cx, min_n=1):
    j = cur.join(prev, lsuffix="_c", rsuffix="_p", how="inner")
    j = j[(j.n_c >= min_n) & (j.n_p >= min_n)]
    j["d"] = j.med_c - j.med_p; j["w"] = np.minimum(j.n_c, j.n_p)
    k = j.index.map(cb_cx)
    return (j.d * j.w).groupby(k).sum() / j.w.groupby(k).sum(), j.w.groupby(k).sum()


def run(sales, rents, M1, M2, B, F, min_label_n=2):
    s = sales[~sales.outlier]
    cb_cx = s.drop_duplicates("cb").set_index("cb").cx
    info = s.groupby("cx").agg(sgg=("sgg", "first"), built=("built", "median"), apt=("apt", "first"), cx_key=("cx_key", "first"))
    f = pd.DataFrame(index=info.index)
    f["cx_mom"], _ = change(cb_med(s, *M2), cb_med(s, *M1), cb_cx)
    cnt = lambda a, b, key="cx": s[(s.m >= a) & (s.m <= b)].groupby(key).size()
    c1, c2 = cnt(*M1).reindex(f.index, fill_value=0), cnt(*M2).reindex(f.index, fill_value=0)
    f["cx_vol_chg"] = np.log((c2 / (M2[1] - M2[0] + 1) + .5) / (c1 / (M1[1] - M1[0] + 1) + .5))
    f["cx_liq"] = np.log1p(c1 + c2)
    # 지역
    rmom, _ = change(cb_med(s, *M2), cb_med(s, *M1), s.drop_duplicates("cb").set_index("cb").sgg)
    r1, r2 = cnt(*M1, key="sgg"), cnt(*M2, key="sgg")
    f["reg_mom"] = info.sgg.map(rmom)
    f["reg_vol_chg"] = info.sgg.map(np.log((r2 / (M2[1] - M2[0] + 1)) / (r1 / (M1[1] - M1[0] + 1))))
    # 신고가 비율(기간 내), 연식, 전세가율
    w = s[(s.m >= M2[0]) & (s.m <= M2[1])]
    f["new_high_share"] = w.groupby("cx").new_high.mean()
    f["age"] = (M2[1] // 12) - info.built
    if rents is not None:
        rr = rents[(rents.m >= M1[0]) & (rents.m <= M2[1])].groupby(["cx_key", "band"]).deposit.median()
        ss = s[(s.m >= M1[0]) & (s.m <= M2[1])].groupby(["cx_key", "band"]).price.median()
        ratio = (rr / ss).dropna(); ratio = ratio[(ratio > .2) & (ratio < 1.2)]
        f["jeonse"] = info.cx_key.map(ratio.groupby(level=0).median())
    # 결과
    y, wy = change(cb_med(s, *F), cb_med(s, *B), cb_cx, min_n=min_label_n)
    f["y"] = y; f["wy"] = wy
    ev = f.dropna(subset=["y"])
    res = {"windows": {k: [month_label(v[0]), month_label(v[1])] for k, v in dict(M1=M1, M2=M2, B=B, F=F).items()},
           "n_complexes": int(len(ev)), "market_median_ret": float(np.expm1(ev.y.median())),
           "share_up_2pct": float((ev.y > .02).mean()), "share_down_2pct": float((ev.y < -.02).mean()), "signals": {}}
    names = {"cx_mom": "단지 가격 흐름(직전 3개월)", "cx_vol_chg": "단지 거래량 변화", "cx_liq": "단지 거래 활발도",
             "reg_mom": "시군구 가격 흐름", "reg_vol_chg": "시군구 거래량 변화", "new_high_share": "신고가 비율",
             "age": "연식(오래될수록 큼)", "jeonse": "전세가율"}
    for col, nm in names.items():
        if col not in ev: continue
        e = ev.dropna(subset=[col])
        if len(e) < 50: continue
        ic = spearmanr(e[col], e.y).statistic
        # 부트스트랩 95% 구간
        rng = np.random.default_rng(0); bs = []
        for _ in range(300):
            i = rng.integers(0, len(e), len(e)); bs.append(spearmanr(e[col].values[i], e.y.values[i]).statistic)
        q = pd.qcut(e[col].rank(method="first"), 5, labels=False)
        top, bot = np.expm1(e.y[q == 4]), np.expm1(e.y[q == 0])
        res["signals"][nm] = {"n": int(len(e)), "ic": float(ic), "ic_lo": float(np.percentile(bs, 2.5)), "ic_hi": float(np.percentile(bs, 97.5)),
                             "top20_ret": float(top.median()), "bottom20_ret": float(bot.median()),
                             "top20_up_share": float((e.y[q == 4] > .02).mean()), "bottom20_up_share": float((e.y[q == 0] > .02).mean())}
    return res, f


if __name__ == "__main__":
    sales = pd.read_pickle("data/sales.pkl"); rents = pd.read_pickle("data/rents.pkl")
    res, f = run(sales, rents, M1=(m_of("2025-11"), m_of("2026-01")), M2=(m_of("2026-02"), m_of("2026-03")),
                 B=(m_of("2026-04"), m_of("2026-05")), F=(m_of("2026-07"), m_of("2026-09")))
    print(json.dumps(res, ensure_ascii=False, indent=1))
    json.dump(res, open("data/factor_test.json", "w"), ensure_ascii=False, indent=1)
