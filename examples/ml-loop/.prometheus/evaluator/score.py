from pathlib import Path


score = float(Path("logs/latest_score.txt").read_text(encoding="utf-8"))
if not 0.0 <= score <= 1.0:
    raise SystemExit("score must be between 0 and 1")
print(score)
