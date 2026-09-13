#!/usr/bin/env python3
"""Static file server for the portfolio site (runtime entry point).

The portfolio is a purely static site (``index.html`` + ``assets/``), so its
runtime is a static HTTP server. This module serves the repository root over
HTTP using only the Python standard library - no dependencies, no build step,
nothing added to the page itself.

Usage:
    python3 server.py                 # http://0.0.0.0:8080
    python3 server.py --port 8149     # custom port
    PORT=8149 HOST=127.0.0.1 python3 server.py
"""

from __future__ import annotations

import argparse
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


class PortfolioHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the repository root with sane MIME types and no caching."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".eot": "application/vnd.ms-fontobject",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))
        sys.stderr.flush()


def build_server(host: str, port: int):
    """Returns a configured ThreadingHTTPServer for the portfolio root."""
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    return http.server.ThreadingHTTPServer((host, port), PortfolioHandler)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Serve the portfolio static site.")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    args = parser.parse_args(argv)

    with build_server(args.host, args.port) as httpd:
        print("portfolio server on http://%s:%d  (root: %s)" % (args.host, args.port, ROOT), flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nshutting down", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
