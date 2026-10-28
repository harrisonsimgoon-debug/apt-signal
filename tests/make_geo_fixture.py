"""테스트 전용: site/ 를 site_geo/ 로 복사하고 단지마다 가짜 좌표를 넣는다 (같은 동네 단지는 서로 가깝게).
실제 좌표는 pipeline.infra 가 채운다. 이 폴더는 배포하지 않는다.
"""
import hashlib, json, shutil
from pathlib import Path

src, dst = Path("site"), Path("site_geo")
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(src, dst)

def anchor(sgg, umd):
    h = int(hashlib.md5(f"{sgg}|{umd}".encode()).hexdigest(), 16)
    return 34.75 + (h % 4500) / 10000, 126.40 + (h // 4500 % 13000) / 10000  # 동네마다 다른 점 (서로 1km 이상 떨어지게 격자)

for idx_p in dst.glob("data/*/index.json"):
    d = json.loads(idx_p.read_text())
    pos = {}
    for e in d["search"]:
        la, ln = anchor(e[3], e[4]); j = (e[1] % 7 - 3) * 0.0004
        e[7], e[8] = round(la + j, 6), round(ln - j, 6); pos[e[1]] = (e[7], e[8])
    d["meta"]["geo_cover"] = 100
    idx_p.write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")))
    for c_p in idx_p.parent.glob("c/*.json"):
        c = json.loads(c_p.read_text())
        for x in c["cx"]:
            x["lat"], x["lng"] = pos[x["id"]]
        c_p.write_text(json.dumps(c, ensure_ascii=False, separators=(",", ":")))
print("site_geo/ 준비 (테스트 전용 가짜 좌표)")
