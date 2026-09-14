"""Contract tests for the hero 3-D (`typing3d.js`) animation layer.

These pin the *static* contract between the WebGL hero and the rest of the site:

* the Three.js renderer must keep the CSS box size and let CSS own the backing
  store ratio (`setSize(w, h, true)` + a `--t3d-pixel-ratio` design token),
* both hero scripts must be deferred so they never block the first paint,
* and no debug/scratch screenshot path may leak into the shipped source tree.

They are pure text assertions (no browser, no server) so they run anywhere.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TYPING3D_JS = ROOT / "assets" / "js" / "typing3d.js"
STYLE_CSS = ROOT / "assets" / "css" / "style.css"
RESPONSIVE_CSS = ROOT / "assets" / "css" / "responsive.css"
INDEX_HTML = ROOT / "index.html"

#: Debug artefact of the macOS screenshot tool; it must never reach the repo.
SCRATCH_SCREENSHOT_PATH = "NSIRD_screencaptureui"

#: Extensions considered "source" when scanning for leaked scratch paths.
SOURCE_SUFFIXES = {
    ".html",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".py",
    ".md",
    ".txt",
    ".svg",
    ".webmanifest",
}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _script_tag(html: str, src: str) -> str:
    """Return the <script ...> opening tag whose src is *src* (last segment match)."""
    for tag in re.findall(r"<script\b[^>]*>", html, re.IGNORECASE):
        if re.search(r'src\s*=\s*["\'][^"\']*' + re.escape(src) + r'["\']', tag):
            return tag
    raise AssertionError("<script src=...%s> tag not found in index.html" % src)


def test_typing3d_keeps_css_size_with_update_style_flag():
    """`renderer.setSize(w, h, true)` — the third positional arg must be `true`.

    With `false` (or omitted) Three.js writes `canvas.style.width/height`, which
    fights the CSS that positions the glyph layer over the hero <h2>. The `true`
    flag keeps the drawing buffer sized while CSS owns the layout box.
    """
    src = _read(TYPING3D_JS)
    assert re.search(r"renderer\.setSize\([^)]*,\s*true\s*\)", src), (
        "typing3d.js must call renderer.setSize(w, h, true) so CSS keeps the canvas box"
    )


def test_typing3d_honours_pixel_ratio_token():
    """The JS must use `setPixelRatio` driven by the `--t3d-pixel-ratio` token."""
    src = _read(TYPING3D_JS)
    assert "setPixelRatio" in src, "typing3d.js must call renderer.setPixelRatio(...)"
    assert "t3d-pixel-ratio" in src, (
        "typing3d.js must read the --t3d-pixel-ratio token so CSS can cap the DPR"
    )


def test_style_css_declares_pixel_ratio_token():
    assert "--t3d-pixel-ratio" in _read(STYLE_CSS), (
        "assets/css/style.css must declare the --t3d-pixel-ratio token"
    )


def test_responsive_css_declares_pixel_ratio_token():
    assert "--t3d-pixel-ratio" in _read(RESPONSIVE_CSS), (
        "assets/css/responsive.css must declare the --t3d-pixel-ratio token"
    )


def test_index_defers_hero_scripts():
    """Both hero scripts must be `defer`red so they never block the first paint."""
    html = _read(INDEX_HTML)
    for src in ("three.min.js", "typing3d.js"):
        tag = _script_tag(html, src)
        assert re.search(r"\bdefer\b", tag), (
            "index.html <script src=...%s> must carry the `defer` attribute (got: %s)"
            % (src, tag)
        )


def test_no_scratch_screenshot_path_in_source_tree():
    """Fail if any shipped source file references the scratch screenshot path.

    Tool/agent scratch directories (`.mini`, `.git`, …) are not shipped source,
    so only real source paths are scanned.
    """
    current = Path(__file__).resolve()
    ignored_dirs = {".git", "node_modules", "__pycache__", ".mini"}
    offenders = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in SOURCE_SUFFIXES:
            continue
        if path.resolve() == current:
            continue  # this test names the scratch path on purpose
        try:
            parts = set(path.relative_to(ROOT).parts)
        except ValueError:  # pragma: no cover - defensive
            continue
        if parts & ignored_dirs:
            continue
        if SCRATCH_SCREENSHOT_PATH in _read(path):
            offenders.append(str(path.relative_to(ROOT)))
    assert not offenders, (
        "scratch screenshot path %r leaked into: %s"
        % (SCRATCH_SCREENSHOT_PATH, ", ".join(sorted(offenders)))
    )
