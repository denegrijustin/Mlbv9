"""Calibration report: predicted probability vs actual outcome per bucket, plus Brier score."""
import json, sys


def calibration(path="desk_log.jsonl", buckets=5):
    rows = [json.loads(l) for l in open(path)]
    pairs = [(r["p"], r["outcome"]) for r in rows if r["event"] == "outcome"]
    if not pairs:
        return "no resolved outcomes"
    brier = sum((p - o) ** 2 for p, o in pairs) / len(pairs)
    lines = [f"n={len(pairs)}  brier={brier:.4f}", "bucket      n   predicted  actual"]
    for b in range(buckets):
        lo, hi = b / buckets, (b + 1) / buckets
        sel = [(p, o) for p, o in pairs if lo <= p < hi or (b == buckets - 1 and p == 1)]
        if sel:
            lines.append(f"{lo:.1f}-{hi:.1f}  {len(sel):4d}   {sum(p for p,_ in sel)/len(sel):.3f}     {sum(o for _,o in sel)/len(sel):.3f}")
    return "\n".join(lines)


if __name__ == "__main__":
    print(calibration(*(sys.argv[1:2])))
