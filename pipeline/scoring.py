"""시세 신호 점수(v2).

같은 시도 안의 다른 단지와 비교한 상대 점수. 시장 전체 방향은 판단하지 않는다.
광주·전남 1년 데이터 예비 검증으로 고른 가중치: 시군구 실거래가 흐름 0.5, 전세가율 0.3, 단지 거래량 변화 0.2
"""
from __future__ import annotations

import numpy as np
import pandas as pd

W = {"reg_mom": 0.5, "jeonse": 0.3, "cx_vol_chg": 0.2}


def _cb_med(s, a, b):
    g = s[(s.m >= a) & (s.m <= b)].groupby("cb").lu
    return pd.DataFrame({"med": g.median(), "n": g.size()})


def _change(cur, prev, key_map):
    j = cur.join(prev, lsuffix="_c", rsuffix="_p", how="inner")
    j["d"] = j.med_c - j.med_p; j["w"] = np.minimum(j.n_c, j.n_p)
    k = j.index.map(key_map)
    return j.assign(k=k)


def _wmedian(j):
    out = {}
    for k, g in j.groupby("k"):
        g = g.sort_values("d"); c = g.w.cumsum()
        out[k] = g.d.iloc[int(np.searchsorted(c.values, c.iloc[-1] / 2))]
    return pd.Series(out, dtype=float)


def features(sales: pd.DataFrame, rents: pd.DataFrame | None, L: int) -> pd.DataFrame:
    """L = 마지막 완료 월. 최근 3개월(M2)과 그 전 3개월(M1) 비교."""
    s = sales[~sales.outlier]
    M1, M2 = (L - 5, L - 3), (L - 2, L)
    win = lambda a, b: s[(s.m >= a) & (s.m <= b)]
    cbinfo = s.drop_duplicates("cb").set_index("cb")
    info = s.groupby("cx").agg(cx_key=("cx_key", "first"), sido=("sido", "first"), sgg=("sgg", "first"),
                               umd=("umd", "first"), jibun=("jibun", "first"), apt=("apt", "first"), built=("built", "median"))
    f = info.copy()
    f["n1"] = win(*M1).groupby("cx").size().reindex(f.index, fill_value=0)
    f["n2"] = win(*M2).groupby("cx").size().reindex(f.index, fill_value=0)
    f = f[(f.n1 + f.n2) > 0]
    f["cx_vol_chg"] = np.log((f.n2 / 3 + .5) / (f.n1 / 3 + .5))
    j = _change(_cb_med(s, *M2), _cb_med(s, *M1), cbinfo.sgg)
    j["k"] = j.index.map(cbinfo.sido) + "|" + j.k
    rm = _wmedian(j)
    f["reg_mom"] = (f.sido + "|" + f.sgg).map(rm)
    f["reg_n2"] = (f.sido + "|" + f.sgg).map(win(*M2).assign(k=lambda d: d.sido + "|" + d.sgg).groupby("k").size())
    if rents is not None and len(rents):
        r = rents[(rents.m >= M1[0]) & (rents.m <= M2[1])].groupby(["cx_key", "band"]).deposit.median()
        p = s[(s.m >= M1[0]) & (s.m <= M2[1])].groupby(["cx_key", "band"]).price.median()
        ratio = (r / p).dropna(); ratio = ratio[(ratio > .2) & (ratio < 1.2)]
        f["jeonse"] = f.cx_key.map(ratio.groupby(level=0).median())
    else:
        f["jeonse"] = np.nan
    return f


def score(f: pd.DataFrame) -> pd.DataFrame:
    """시도별로 표준화한 가중합 → 50점 기준 점수, 단계."""
    out = []
    for _, g in f.groupby("sido"):
        g = g.copy()
        z = pd.DataFrame(index=g.index)
        for k in W:
            x = g[k]
            if x.notna().sum() < 5 or x.std() == 0:
                z[k] = 0.0; continue
            x = x.clip(x.quantile(.02), x.quantile(.98))
            z[k] = ((x - x.mean()) / x.std()).fillna(0)
        c = sum(z[k] * w for k, w in W.items())
        c = c / c.std() if c.std() > 0 else c
        g["score"] = (50 + 15 * c).clip(5, 95).round().astype(int)
        g["lv"] = np.where(g.score >= 60, "up", np.where(g.score >= 42, "flat", "down"))
        for k, w in W.items():
            g[f"w_{k}"] = (z[k] * w).round(3)
        out.append(g)
    return pd.concat(out)
