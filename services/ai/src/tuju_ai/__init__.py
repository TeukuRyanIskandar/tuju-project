"""tuju-ai — Bursa platform AI worker (Python).

Its own uv-managed world, outside the pnpm/Turbo graph (ADR-0002). Entrypoints:

* ``tuju-ai-worker`` — boot the BullMQ worker against Redis (requires live infra).
* ``tuju-ai-smoke``  — run the full handler path offline (no Redis/S3).
"""

__version__ = "0.1.0"


def hello() -> str:
    return "Hello from tuju-ai!"
