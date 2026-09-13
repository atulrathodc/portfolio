#!/usr/bin/env python3
"""Root entry point: delegates to the portfolio server in ``backend/server.py``.

Keeps the historical ``python3 server.py`` invocation working while the actual
implementation (static site + JSON API) lives in one place. No dependencies.

Usage:
    python3 server.py                 # http://0.0.0.0:8080
    python3 server.py --port 8149     # custom port
    PORT=8149 HOST=127.0.0.1 python3 server.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from backend.server import PortfolioHandler, build_server, main  # noqa: E402,F401

if __name__ == "__main__":
    raise SystemExit(main())
