"""국토교통부 아파트 매매·전월세 실거래 자동 수집.

  python -m pipeline.collect daily            # 전국 시군구 × 최근 3개월 다시 받기 (지연 신고·해제 반영)
  python -m pipeline.collect backfill 202001  # 과거 적재. 호출 한도에 닿으면 멈추고 다음 실행에서 이어 받음

환경 변수: DATA_GO_KR_KEY (공공데이터포털 일반 인증키, Decoding), MAX_CALLS (1회 실행 최대 호출 수, 기본 9000)
저장: store/raw/{sale|rent}/{YYYYMM}/{시군구코드}.csv.gz, 진행 상태 store/state.json
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd
import requests

STORE = Path(os.environ.get("STORE_DIR", "store"))
API = {
    "sale": "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev",
    "rent": "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent",
}
REGION_API = "https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList"
OK_CODES = {"00", "000"}


class QuotaExceeded(Exception):
    pass


class Budget:
    def __init__(self, n):
        self.left = n

    def take(self):
        if self.left <= 0:
            raise QuotaExceeded("이번 실행의 호출 한도(MAX_CALLS)를 다 썼습니다")
        self.left -= 1


def _get(url, params, budget, tries=4):
    budget.take()
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=30)
            if r.status_code == 429:
                raise QuotaExceeded("공공데이터포털 일일 트래픽 초과(429)")
            r.raise_for_status()
            return r.text
        except QuotaExceeded:
            raise
        except Exception as e:  # 네트워크 오류는 잠시 쉬고 다시
            if i == tries - 1:
                raise
            time.sleep(2 ** i)


# ---------- 시군구 목록 ----------
def regions(key, budget, refresh_days=30) -> pd.DataFrame:
    path = STORE / "regions.csv"
    if path.exists() and (time.time() - path.stat().st_mtime) < refresh_days * 86400:
        return pd.read_csv(path, dtype=str)
    rows, page = [], 1
    while True:
        txt = _get(REGION_API, {"serviceKey": key, "type": "json", "pageNo": page, "numOfRows": 1000}, budget)
        js = json.loads(txt)
        body = js.get("StanReginCd", [{}, {}])
        items = body[1].get("row", []) if len(body) > 1 else []
        if not items:
            break
        rows += items
        page += 1
    df = pd.DataFrame(rows)
    # 시군구 단위(읍면동·리 코드가 0)만, 폐지 코드는 상위 이름이 비어 있는 경우가 있어 이름 있는 것만
    df = df[(df.umd_cd == "000") & (df.ri_cd == "00") & (df.sgg_cd != "000")]
    df["code"] = df.region_cd.str[:5]
    df["sido"] = df.locatadd_nm.str.split().str[0]
    df["sgg"] = df.locatadd_nm.str.split().str[1:].str.join(" ")
    df = df.drop_duplicates("code")[["code", "sido", "sgg"]]
    # 일반구가 있는 시(예: 성남시 41130)는 구 코드(41131…)로 받으므로 상위 시 코드는 뺀다
    has_child = {c[:4] for c in df.code if not c.endswith("0")}
    df = df[~(df.code.str.endswith("0") & df.code.str[:4].isin(has_child))]
    STORE.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)
    return df


# ---------- 실거래 ----------
def _items(txt):
    root = ET.fromstring(txt)
    code = (root.findtext(".//resultCode") or "").strip()
    if code and code not in OK_CODES:
        msg = root.findtext(".//resultMsg") or ""
        if code in ("22", "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR"):
            raise QuotaExceeded(msg)
        raise RuntimeError(f"API 오류 {code}: {msg}")
    total = int(root.findtext(".//totalCount") or 0)
    items = [{c.tag: (c.text or "").strip() for c in it} for it in root.iter("item")]
    return items, total


def fetch(kind, lawd, ym, key, budget):
    out, page = [], 1
    while True:
        txt = _get(API[kind], {"serviceKey": key, "LAWD_CD": lawd, "DEAL_YMD": ym, "pageNo": page, "numOfRows": 1000}, budget)
        items, total = _items(txt)
        out += items
        if len(out) >= total or not items:
            return out
        page += 1


def normalize(kind, items, reg_row) -> pd.DataFrame:
    if not items:
        return pd.DataFrame()
    d = pd.DataFrame(items)
    g = lambda c: d[c] if c in d else ""
    num = lambda c: pd.to_numeric(g(c).astype(str).str.replace(",", "").str.strip(), errors="coerce") if c in d else pd.Series([None] * len(d))
    out = pd.DataFrame({
        "sido": reg_row.sido, "sgg": reg_row.sgg, "umd": g("umdNm"), "jibun": g("jibun"), "apt": g("aptNm"),
        "apt_seq": g("aptSeq"), "area": num("excluUseAr"), "floor": num("floor"), "built": num("buildYear"),
        "ymd": g("dealYear").astype(str) + "-" + g("dealMonth").astype(str).str.zfill(2) + "-" + g("dealDay").astype(str).str.zfill(2),
    })
    if kind == "sale":
        out["price"] = num("dealAmount")
        out["cancelled"] = g("cdealType").astype(str).str.strip().ne("") & g("cdealType").astype(str).ne("-") if "cdealType" in d else False
        out["direct"] = g("dealingGbn").astype(str).str.contains("직거래") if "dealingGbn" in d else False
    else:
        out["deposit"] = num("deposit")
        out["monthly"] = num("monthlyRent")
        out["contract"] = g("contractType")
    return out


def save(kind, ym, lawd, df):
    p = STORE / "raw" / kind / ym / f"{lawd}.csv.gz"
    p.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(p, index=False, compression={"method": "gzip", "mtime": 0})


def months_between(a: str, b: str):
    y, m = int(a[:4]), int(a[4:])
    while f"{y}{m:02d}" <= b:
        yield f"{y}{m:02d}"
        m += 1
        if m == 13:
            y, m = y + 1, 1


def run(mode, start=None, kinds=("sale", "rent")):
    key = os.environ["DATA_GO_KR_KEY"].strip()
    budget = Budget(int(os.environ.get("MAX_CALLS", 9000)))
    state_p = STORE / "state.json"
    state = json.loads(state_p.read_text()) if state_p.exists() else {"done": {}}
    today = dt.date.today()
    this_ym = f"{today:%Y%m}"
    regs = regions(key, budget)
    if mode == "daily":
        recent = list(months_between(f"{(today.replace(day=1) - dt.timedelta(days=62)):%Y%m}", this_ym))
        jobs = [(k, ym, r) for ym in recent for k in kinds for r in regs.itertuples()]
    else:
        jobs = [(k, ym, r) for ym in months_between(start or "202001", this_ym) for k in kinds for r in regs.itertuples()
                if f"{k}/{ym}/{r.code}" not in state["done"]]
    print(f"{mode}: 작업 {len(jobs):,}건, 호출 한도 {budget.left:,}")
    n = 0
    try:
        for k, ym, r in jobs:
            items = fetch(k, r.code, ym, key, budget)
            save(k, ym, r.code, normalize(k, items, r))
            state["done"][f"{k}/{ym}/{r.code}"] = dt.datetime.now().isoformat(timespec="seconds")
            n += 1
            if n % 200 == 0:
                print(f"  {n:,}/{len(jobs):,} ({k} {ym} {r.sido} {r.sgg})")
                state_p.write_text(json.dumps(state))
    except QuotaExceeded as e:
        print(f"멈춤: {e}. 완료 {n:,}건, 다음 실행에서 이어 받습니다.")
    state_p.write_text(json.dumps(state))
    print(f"완료 {n:,}/{len(jobs):,}")


if __name__ == "__main__":
    run(sys.argv[1], *(sys.argv[2:3]))
