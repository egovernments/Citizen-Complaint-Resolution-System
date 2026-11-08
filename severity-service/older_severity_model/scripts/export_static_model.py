"""Export model/catboost_pgr.cbm into files a browser can evaluate with no server.

CatBoost's categorical feature (`ctype`) enters the trees only through 337 CTR splits whose outcome
depends solely on the complaint type, so for each known type we precompute those outcomes by asking
the real model for leaf indexes. What remains is a plain float-feature oblivious-tree ensemble.

    python scripts/export_static_model.py [outdir]     # default: static-space/

Writes model.json (structure + per-type CTR bits) and model.bin (float32 leaf values), then
re-evaluates a random sample with the exported form and compares it with CatBoost.
"""
import json
import struct
import sys
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from catboost import CatBoostClassifier, Pool

SVC = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else SVC / "static-space"
UNKNOWN = "\u0000__unseen__"  # a value the model never saw -> CatBoost's unseen-category path

model = CatBoostClassifier()
model.load_model(str(SVC / "model" / "catboost_pgr.cbm"))
labels = json.loads((SVC / "model" / "label_map.json").read_text("utf-8"))["labels"]
ctypes = json.loads((SVC / "model" / "ctype_values.json").read_text("utf-8"))
FEATS = [f"e{i}" for i in range(384)] + ["ctype"]

with tempfile.TemporaryDirectory() as tmp:
    model.save_model(str(Path(tmp) / "m.json"), format="json")
    j = json.loads((Path(tmp) / "m.json").read_text("utf-8"))
trees = j["oblivious_trees"]
assert j["scale_and_bias"][0] == 1 and not any(j["scale_and_bias"][1]), j["scale_and_bias"]
DIM = len(labels)

# --- structure: per tree, per split (in JSON order) a float feature + border, or a CTR slot ---
feat, border, ctr_slot = [], [], []  # flat over trees*6
ctr_positions = []                   # (tree, position) of every CTR split
for t, tr in enumerate(trees):
    assert len(tr["splits"]) == 6 and len(tr["leaf_values"]) == 64 * DIM
    for pos, s in enumerate(tr["splits"]):
        if s["split_type"] == "FloatFeature":
            feat.append(s["float_feature_index"]); border.append(s["border"]); ctr_slot.append(-1)
        else:
            feat.append(-1); border.append(0.0); ctr_slot.append(len(ctr_positions))
            ctr_positions.append((t, pos))

rng = np.random.default_rng(0)
e_star = rng.normal(size=384)
e_star /= np.linalg.norm(e_star)


def leaf_indexes(rows: pd.DataFrame) -> np.ndarray:
    return np.asarray(model.calc_leaf_indexes(Pool(rows, cat_features=["ctype"])))


# Which bit of the leaf index does JSON split `pos` control? Check with float splits only.
probe = pd.DataFrame([np.append(e_star, ctypes[0])], columns=FEATS)
probe.iloc[:, :384] = probe.iloc[:, :384].astype(float)
idx0 = leaf_indexes(probe)[0]
for order in ("lsb_first", "msb_first"):
    ok = True
    for t, tr in enumerate(trees[:300]):
        for pos, s in enumerate(tr["splits"]):
            if s["split_type"] != "FloatFeature":
                continue
            bit = (idx0[t] >> (pos if order == "lsb_first" else 5 - pos)) & 1
            if bit != int(e_star[s["float_feature_index"]] > s["border"]):
                ok = False
                break
        if not ok:
            break
    if ok:
        BIT = (lambda p: p) if order == "lsb_first" else (lambda p: 5 - p)
        print("split order:", order)
        break
else:
    sys.exit("could not determine split bit order")

# --- per-type CTR outcomes ---
names = ctypes + [UNKNOWN]
bits = []
for c in names:
    row = pd.DataFrame([np.append(e_star, c)], columns=FEATS)
    row.iloc[:, :384] = row.iloc[:, :384].astype(float)
    idx = leaf_indexes(row)[0]
    bits.append("".join(str((int(idx[t]) >> BIT(pos)) & 1) for t, pos in ctr_positions))

OUT.mkdir(parents=True, exist_ok=True)
leaf = np.array([tr["leaf_values"] for tr in trees], dtype="<f4")  # (trees, 64*DIM) leaf-major
(OUT / "model.bin").write_bytes(leaf.tobytes())
(OUT / "model.json").write_text(json.dumps({
    "labels": labels, "dim": DIM, "trees": len(trees), "depth": 6,
    "feat": feat, "border": [float(np.float32(b)) for b in border], "ctrSlot": ctr_slot,
    "ctypes": ctypes, "ctrBits": bits,   # last row = unseen type
}, separators=(",", ":")), encoding="utf-8")
print("wrote", OUT / "model.json", (OUT / "model.json").stat().st_size, "bytes;",
      OUT / "model.bin", (OUT / "model.bin").stat().st_size, "bytes")


# --- verify: evaluate the exported form and compare against CatBoost ---
def softmax(z):
    z = z - z.max(); e = np.exp(z); return e / e.sum()


def eval_export(x, cname):
    ci = names.index(cname) if cname in names else len(names) - 1
    raw = np.zeros(DIM)
    for t in range(len(trees)):
        idx = 0
        for pos in range(6):
            k = t * 6 + pos
            if feat[k] >= 0:
                b = int(x[feat[k]] > border[k])
            else:
                b = int(bits[ci][ctr_slot[k]])
            idx |= b << BIT(pos)
        raw += leaf[t, idx * DIM:(idx + 1) * DIM]
    return softmax(raw)


worst = 0.0
for i in range(150):
    x = rng.normal(size=384); x /= np.linalg.norm(x)
    c = ctypes[i % len(ctypes)] if i % 10 else "never-seen type"
    X = pd.DataFrame([np.append(x, c)], columns=FEATS)
    X.iloc[:, :384] = X.iloc[:, :384].astype(float)
    ref = model.predict_proba(X)[0]
    worst = max(worst, float(np.abs(ref - eval_export(x, c)).max()))
print("max |prob difference| over 150 random rows (incl. unseen types):", worst)
sys.exit(0 if worst < 1e-4 else "MISMATCH")
