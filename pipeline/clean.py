"""거래 정제: 해제 거래 제거, 면적대, 단지 식별, 이상치 표시, 신고가 여부."""
from __future__ import annotations

import numpy as np
import pandas as pd

BANDS = [0, 40, 60, 85, 102, 135, np.inf]
BAND_LABELS = ["40㎡ 이하", "40~60㎡", "60~85㎡", "85~102㎡", "102~135㎡", "135㎡ 초과"]
OUTLIER_TOL = 0.30  # 같은 단지·면적대 직전 거래 중위값에서 30% 넘게 벗어나면 이상치


def month_index(ts: pd.Series) -> pd.Series:
    return ts.dt.year * 12 + ts.dt.month - 1


def month_label(m: int) -> str:
    return f"{m // 12}-{m % 12 + 1:02d}"


def clean_sales(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.loc[~raw["cancelled"].astype(bool)].copy()
    df = df[(df.price > 0) & (df.area > 10)]
    df["band"] = pd.cut(df.area, BANDS, labels=False, right=True).astype(int)
    df["cx_key"] = df.sido.str.cat([df.sgg, df.umd, df.jibun.astype(str), df.apt], sep="|")
    df["cx"] = pd.factorize(df.cx_key)[0]
    df["cb"] = pd.factorize(df.cx_key + "#" + df.band.astype(str))[0]
    df["m"] = month_index(df.ymd)
    df["unit"] = df.price / df.area          # 만원/㎡
    df["lu"] = np.log(df.unit)
    df = df.sort_values(["cb", "ymd"]).reset_index(drop=True)

    # 이상치: 같은 단지·면적대의 직전 최대 6건 중위값 대비 ±30%
    prev_med = df.groupby("cb").lu.transform(lambda s: s.shift(1).rolling(6, min_periods=3).median())
    df["outlier"] = (np.abs(df.lu - prev_med) > np.log1p(OUTLIER_TOL)) & prev_med.notna()

    # 신고가: 같은 단지·면적대 이전 정상 거래의 최고가를 넘은 거래
    clean_lu = df.lu.where(~df.outlier)
    prev_max = clean_lu.groupby(df.cb).transform(lambda s: s.shift(1).cummax())
    df["new_high"] = (df.lu > prev_max) & prev_max.notna() & ~df.outlier
    return df


def clean_rents(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.copy()
    df = df[(df.deposit > 0) & (df.area > 10)]
    df = df[df.monthly.fillna(0) == 0]  # 전세만
    df["band"] = pd.cut(df.area, BANDS, labels=False, right=True).astype(int)
    df["cx_key"] = df.sido.str.cat([df.sgg, df.umd, df.jibun.astype(str), df.apt], sep="|")
    df["m"] = month_index(df.ymd)
    return df


def region_index(df: pd.DataFrame, iters: int = 15) -> pd.DataFrame:
    """시군구별 월간 가격지수(단지·면적대 고정효과 + 월 효과). 호가 판단처럼 현재 시점 계산용.

    전체 기간 데이터를 쓰므로 백테스트 지표에는 쓰지 않는다(미래 정보 누수).
    반환: sgg, m, idx (log, 첫 달 0)
    """
    d = df.loc[~df.outlier, ["sgg", "cb", "m", "lu"]].copy()
    d["g"] = 0.0
    for _ in range(iters):
        d["a"] = (d.lu - d.g).groupby(d.cb).transform("mean")
        d["g"] = (d.lu - d.a).groupby([d.sgg, d.m]).transform("mean")
    out = d.groupby(["sgg", "m"]).g.mean().rename("idx").reset_index()
    out["n"] = d.groupby(["sgg", "m"]).size().values
    full = []
    for sgg, g in out.groupby("sgg"):
        g = g.set_index("m").reindex(range(g.m.min(), g.m.max() + 1))
        g["sgg"] = sgg
        g["idx"] = g.idx.interpolate().rolling(3, min_periods=1, center=True).mean()
        g["idx"] -= g.idx.iloc[0]
        full.append(g.reset_index())
    return pd.concat(full, ignore_index=True)[["sgg", "m", "idx", "n"]]
