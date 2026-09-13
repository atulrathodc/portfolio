#!/usr/bin/env python3
"""Portfolio runtime entry point: static site server + read-only JSON API.

The portfolio is a purely static site (``index.html`` + ``assets/``) plus this
small REST API that exposes the site's own data (profile, projects, health).
Everything is implemented with the Python standard library - no dependencies,
no build step, and nothing is injected into the published page.

Usage:
    python3 server.py                 # http://0.0.0.0:8080
    python3 server.py --port 8149     # custom port
    PORT=8149 HOST=127.0.0.1 python3 server.py

API:
    GET /api/health     -> {"status": "ok", ...}
    GET /api/profile    -> site owner profile (name/role/title/resume)
    GET /api/projects   -> project thumbnails discovered under assets/images

Documents:
    GET /privacy-policy    -> 302 to assets/download/PrivacyPolicy.pdf
    GET /terms-conditions  -> 302 to assets/download/TermsConditions.pdf
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
# backend/server.py -> repo root; a root-level copy of this module is the root itself.
ROOT = os.path.dirname(_HERE) if os.path.basename(_HERE) == "backend" else _HERE

API_PREFIX = "/api/"
PROJECT_DIR = os.path.join(ROOT, "assets", "images", "portfolio")
RESUME_DIR = os.path.join(ROOT, "assets", "download")
STARTED_AT = time.time()

PROFILE = {
    "name": "Atul Rathod",
    "role": "Fullstack Developer",
    "site": "https://atulrathodc.github.io/portfolio/",
    "resume": "assets/download/AtulRathod_Fullstack_Resume.pdf",
}

_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _natural_key(name: str):
    """Sort p2.svg before p10.svg."""
    return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", name)]


def page_title() -> str:
    """Read the <title> straight from index.html so the API never drifts from the page."""
    try:
        with open(os.path.join(ROOT, "index.html"), encoding="utf-8", errors="replace") as fh:
            match = _TITLE_RE.search(fh.read())
        if match:
            return " ".join(match.group(1).split())
    except OSError:
        pass
    return ""


def projects():
    """Project cards = the images actually shipped in assets/images/portfolio."""
    try:
        names = [n for n in os.listdir(PROJECT_DIR) if not n.startswith(".")]
    except OSError:
        return []
    return [
        {
            "id": os.path.splitext(name)[0],
            "image": "assets/images/portfolio/" + name,
            "url": "#portfolio",
        }
        for name in sorted(names, key=_natural_key)
    ]


def resume_path() -> str:
    """URL of the resume that is actually shipped in assets/download.

    Only files confirmed on disk are ever returned, so the API can never advertise a
    filename the static server would answer with 404 (the historical drift between
    index.html's ``..._Java_developer_Resume.pdf`` and its real ``..._Fullstack_Resume.pdf``).
    """
    canonical = os.path.basename(PROFILE["resume"])
    try:
        # Prefer an actual resume over the legal PDFs (PrivacyPolicy / TermsConditions).
        others = sorted(
            (
                n
                for n in os.listdir(RESUME_DIR)
                if n.lower().endswith(".pdf") and "resume" in n.lower() and n != canonical
            ),
            reverse=True,
        )
    except OSError:
        others = []
    for name in [canonical, *others]:
        if os.path.isfile(os.path.join(RESUME_DIR, name)):
            return "assets/download/" + name
    return PROFILE["resume"]


def profile():
    data = dict(PROFILE)
    data["title"] = page_title()
    items = projects()
    data["project_count"] = len(items)
    data["resume"] = resume_path()
    return data


def health():
    return {
        "status": "ok",
        "service": "portfolio-api",
        "uptime_seconds": round(time.time() - STARTED_AT, 3),
        "routes": sorted(PortfolioHandler.ROUTES),
    }


class PortfolioHandler(http.server.SimpleHTTPRequestHandler):
    """Serves the repository root with sane MIME types, no caching, and the JSON API."""

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

    server_version = "PortfolioHTTP/1.0"
    # HTTP/1.1 keep-alive: safe because every response path (static file, JSON API,
    # redirect) sets Content-Length, and it keeps strict HTTP/1.1-only clients happy.
    protocol_version = "HTTP/1.1"

    ROUTES = {
        "/api/health": staticmethod(health),
        "/api/profile": staticmethod(profile),
        "/api/projects": staticmethod(projects),
    }

    # Legacy / bookmarkable document URLs that must not 404 on the live server.
    REDIRECTS = {
        "/privacy-policy": "assets/download/PrivacyPolicy.pdf",
        "/terms-conditions": "assets/download/TermsConditions.pdf",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    # ---------- API ----------
    def _api_payload(self):
        """(status, payload) for the request path, or None when it is not an API route."""
        path = self.path.split("?", 1)[0].split("#", 1)[0].rstrip("/") or "/"
        if path == "/api":
            return 200, {"service": "portfolio-api", "routes": sorted(self.ROUTES)}
        if not (path + "/").startswith(API_PREFIX):
            return None
        handler = self.ROUTES.get(path)
        if handler is None:
            return 404, {"error": "not_found", "path": path, "routes": sorted(self.ROUTES)}
        return 200, handler()

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _maybe_api(self) -> bool:
        resolved = self._api_payload()
        if resolved is None:
            return False
        self._send_json(*resolved)
        return True

    def _maybe_redirect(self) -> bool:
        """Serve REDIRECTS (e.g. /privacy-policy) as a 302 onto the real document."""
        path = self.path.split("?", 1)[0].split("#", 1)[0].rstrip("/") or "/"
        target = self.REDIRECTS.get(path)
        if target is None:
            return False
        self.send_response(302)
        self.send_header("Location", "/" + target)
        self.send_header("Content-Length", "0")
        self.end_headers()
        return True

    def do_GET(self):  # noqa: N802 (stdlib naming)
        if self._maybe_redirect() or self._maybe_api():
            return
        super().do_GET()

    def do_HEAD(self):  # noqa: N802 (stdlib naming)
        if self._maybe_redirect() or self._maybe_api():
            return
        super().do_HEAD()

    # ---------- headers / logging ----------
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
    parser = argparse.ArgumentParser(description="Serve the portfolio static site and API.")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8080")))
    args = parser.parse_args(argv)

    with build_server(args.host, args.port) as httpd:
        print("portfolio server on http://%s:%d  (root: %s)" % (args.host, args.port, ROOT), flush=True)
        print("api: http://%s:%d/api/health" % (args.host, args.port), flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nshutting down", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
