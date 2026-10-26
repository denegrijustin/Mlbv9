"""Append-only JSONL so calibration can be measured later."""
import json, time


class Log:
    def __init__(self, path="desk_log.jsonl"):
        self.path = path
        self.now = None   # market timestamp of the tick being processed (set by the runner when known)

    def __call__(self, event, **kw):
        with open(self.path, "a") as f:
            f.write(json.dumps({"t": time.time(), "ts": self.now, "event": event, **kw}) + "\n")
