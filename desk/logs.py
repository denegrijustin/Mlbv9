"""Append-only JSONL so calibration can be measured later."""
import json, time


class Log:
    def __init__(self, path="desk_log.jsonl", wall_clock=True):
        self.path = path
        self.wall_clock = wall_clock   # False for rebuilt/replayed logs: 't' would be rebuild time, not market time
        self.now = None   # market timestamp of the tick being processed (set by the runner when known)

    def __call__(self, event, **kw):
        with open(self.path, "a") as f:
            f.write(json.dumps({"t": time.time() if self.wall_clock else 0.0, "ts": self.now, "event": event, **kw}) + "\n")
