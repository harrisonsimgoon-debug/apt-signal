"""실거래가 공개시스템(rt.molit.go.kr)에서 받은 엑셀/CSV를 저장소 형식으로 넣는다.

  python -m pipeline.import_files sale 매매.xlsx [...]
  python -m pipeline.import_files rent 전월세.xlsx [...]

API 키가 나오기 전에 직접 받은 파일로 시작하거나, 과거 데이터를 한 번에 채울 때 쓴다.
같은 거래가 API로 다시 들어와도 빌드 단계에서 중복을 지운다.
"""
import re
import sys
from pathlib import Path

from .collect import STORE
from .molit_file import read_sale_file, read_rent_file


def main(kind, *files):
    reader = read_sale_file if kind == "sale" else read_rent_file
    for f in files:
        df = reader(f)
        if kind == "sale":
            df["apt_seq"] = ""
        else:
            df["contract"] = ""
        df["ym"] = df.ymd.dt.strftime("%Y%m")
        df["ymd"] = df.ymd.dt.strftime("%Y-%m-%d")
        n = 0
        for (ym, sido, sgg), g in df.groupby(["ym", "sido", "sgg"]):
            name = "file_" + re.sub(r"\s+", "_", f"{sido}_{sgg}")
            p = STORE / "raw" / kind / ym / f"{name}.csv.gz"
            p.parent.mkdir(parents=True, exist_ok=True)
            g.drop(columns="ym").to_csv(p, index=False, compression={"method": "gzip", "mtime": 0})
            n += len(g)
        print(f"{Path(f).name}: {n:,}건 저장")


if __name__ == "__main__":
    main(sys.argv[1], *sys.argv[2:])
