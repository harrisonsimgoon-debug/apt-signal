"""시점별 지표와 6개월 뒤 결과 라벨.

규칙: 판단 시점 t(월 초)에는 t-1월까지 계약된 거래만 쓴다. 실거래 신고 기한이 30일이라
t-1월 거래는 t월 초에 대부분 신고되어 있다. 라벨은 t..t+5월 거래로 만든다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FEATURES = [
    "cx_mom3", "cx_mom6", "cx_vol_chg", "cx_vol6", "liq24", "peak_gap", "new_high_share", "age",
    "reg_mom3", "reg_mom12", "reg_vol_chg3", "reg_vol_yoy", "mkt_mom3", "mkt_vol_yoy", "jeonse",
]
UP, FLAT, DOWN = 2, 1, 0
BAND = 0.02  # ±2% 안이면 보합


def _win(df, a, b):
    return df[(df.m >= a) & (df.m <= b)]


def _cb_med(df, a, b):
    g = _win(df, a, b).groupby("cb").lu
    return pd.DataFrame({"med": g.median(), "n": g.size()})


def _pair_change(cur, prev, min_n=1):
    j = cur.join(prev, lsuffix="_c", rsuffix="_p", how="inner")
    j = j[(j.n_c >= min_n) & (j.n_p >= min_n)]
    j["d"] = j.med_c - j.med_p
    j["w"] = np.minimum(j.n_c, j.n_p)
    return j


def _wmean(j, key_map, key):
    j = j.assign(k=j.index.map(key_map))
    return (j.d * j.w).groupby(j.k).sum() / j.w.groupby(j.k).sum()


def _wmedian(j, key_map):
    j = j.assign(k=j.index.map(key_map))
    out = {}
    for k, g in j.groupby("k"):
        g = g.sort_values("d")
        c = g.w.cumsum()
        out[k] = g.d.iloc[int(np.searchsorted(c.values, c.iloc[-1] / 2))]
    return pd.Series(out)


class Panel:
    """반복 계산을 줄이기 위한 사전 계산 묶음."""

    def __init__(self, sales: pd.DataFrame, rents: pd.DataFrame | None = None):
        self.s = sales.loc[~sales.outlier].copy()
        self.all = sales
        cbinfo = sales.drop_duplicates("cb").set_index("cb")
        self.cb_cx = cbinfo.cx
        self.cb_sgg = cbinfo.sgg
        self.cx_info = sales.groupby("cx").agg(cx_key=("cx_key", "first"), apt=("apt", "first"),
                                               sgg=("sgg", "first"), umd=("umd", "first"),
                                               sido=("sido", "first"), built=("built", "median"))
        # 단지·면적대 월 중위값 → 3개월 이동 중위 → 누적 최고
        piv = self.s.groupby(["cb", "m"]).lu.median().unstack()
        piv = piv.reindex(columns=range(int(piv.columns.min()), int(piv.columns.max()) + 1))
        self.roll3 = piv.T.rolling(3, min_periods=2).median().T
        self.peak = self.roll3.T.cummax().T
        self.rents = rents
        self.m_min, self.m_max = int(sales.m.min()), int(sales.m.max())

    def features(self, t: int) -> pd.DataFrame:
        s, L = self.s, t - 1
        cx = self.cx_info.index
        f = pd.DataFrame(index=cx)
        # 단지 모멘텀
        j3 = _pair_change(_cb_med(s, L - 2, L), _cb_med(s, L - 5, L - 3))
        j6 = _pair_change(_cb_med(s, L - 5, L), _cb_med(s, L - 11, L - 6))
        f["cx_mom3"] = _wmean(j3, self.cb_cx, "cx")
        f["cx_mom6"] = _wmean(j6, self.cb_cx, "cx")
        cnt = lambda a, b: _win(s, a, b).groupby("cx").size().reindex(cx, fill_value=0)
        v6, v6p = cnt(L - 5, L), cnt(L - 11, L - 6)
        f["cx_vol6"] = v6
        f["cx_vol_chg"] = np.log((v6 + 1) / (v6p + 1))
        f["liq24"] = np.log1p(cnt(L - 23, L))
        # 전고점 대비
        if L in self.roll3.columns:
            gap = (self.roll3[L] - self.peak[L]).dropna()
            w = _win(s, L - 23, L).groupby("cb").size().reindex(gap.index, fill_value=0) + 1
            f["peak_gap"] = (gap * w).groupby(gap.index.map(self.cb_cx)).sum() / w.groupby(gap.index.map(self.cb_cx)).sum()
        rec = _win(s, L - 2, L)
        f["new_high_share"] = rec.groupby("cx").new_high.mean()
        f["age"] = (t // 12) - self.cx_info.built
        # 지역(시군구)
        r3 = _wmedian(_pair_change(_cb_med(s, L - 2, L), _cb_med(s, L - 5, L - 3)), self.cb_sgg)
        r12 = _wmedian(_pair_change(_cb_med(s, L - 2, L), _cb_med(s, L - 14, L - 12)), self.cb_sgg)
        sc = lambda a, b: _win(s, a, b).groupby("sgg").size()
        c0, c1, cy = sc(L - 2, L), sc(L - 5, L - 3), sc(L - 14, L - 12)
        sgg = self.cx_info.sgg
        f["reg_mom3"] = sgg.map(r3)
        f["reg_mom12"] = sgg.map(r12)
        f["reg_vol_chg3"] = sgg.map(np.log((c0 + 1) / (c1.reindex(c0.index, fill_value=0) + 1)))
        f["reg_vol_yoy"] = sgg.map(np.log((c0 + 1) / (cy.reindex(c0.index, fill_value=0) + 1)))
        # 시장 전체
        jm = _pair_change(_cb_med(s, L - 2, L), _cb_med(s, L - 5, L - 3))
        f["mkt_mom3"] = float(np.average(jm.d, weights=jm.w)) if len(jm) else np.nan
        f["mkt_vol_yoy"] = float(np.log((c0.sum() + 1) / (cy.sum() + 1)))
        f["jeonse"] = self._jeonse(t)
        f["t"] = t
        return f

    def _jeonse(self, t):
        if self.rents is None or self.rents.empty:
            return np.nan
        L = t - 1
        r = _win(self.rents, L - 5, L).groupby(["cx_key", "band"]).deposit.median()
        sale = _win(self.s, L - 5, L).assign(p=lambda d: d.price).groupby(["cx_key", "band"]).p.median()
        ratio = (r / sale).dropna()
        ratio = ratio[(ratio > 0.2) & (ratio < 1.2)]
        by_key = ratio.groupby(level=0).median()
        return self.cx_info.cx_key.map(by_key)

    def label(self, t: int, min_n: int = 2) -> pd.Series:
        """t-6..t-1 대비 t..t+5 단지 가격 변화(log). 거래가 부족한 단지는 빈 값."""
        s = self.s
        j = _pair_change(_cb_med(s, t, t + 5), _cb_med(s, t - 6, t - 1), min_n=min_n)
        return _wmean(j, self.cb_cx, "cx")


def to_class(y: pd.Series) -> pd.Series:
    return pd.Series(np.where(y > BAND, UP, np.where(y < -BAND, DOWN, FLAT)), index=y.index)
