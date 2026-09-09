# Request — Retry Schedule Policy

Add a retry backoff policy module to this project.

## What it must do

Create `retry_policy.py` at the project root. Use only the Python standard
library.

Export exactly these names:

- `Attempt` — a frozen dataclass with fields `index: int` and `delay_ms: int`.
- `PolicyError` — an exception deriving from `ValueError`.
- `schedule(retries: int, base_ms: int, *, cap_ms: int) -> list[Attempt]`.

`schedule` returns one `Attempt` per retry, in ascending `index` order starting
at `0`. Each delay is capped exponential backoff:

    delay_ms = min(base_ms * 2 ** index, cap_ms)

`retries == 0` returns an empty list.

`schedule` raises `PolicyError` when `retries` is negative, when `base_ms` is
zero or negative, or when `cap_ms` is smaller than `base_ms`.

`schedule` must be pure: no filesystem access, no network access, no
randomness, and no mutable global state.

## Tests

Add unit tests under `tests/` that run under standard `unittest` discovery and
cover the ordering, the cap, the empty case, and every error case.
