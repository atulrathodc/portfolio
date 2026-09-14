"""Contract tests for the hero headline (``<h2 class="hero-title">``).

The hero headline is deliberately STATIC - "remove the animation from this text,
keep it simple" - so the copy is plain, semantic, immediately visible text: no
per-letter 3-D entrance, no WebGL typing overlay, no idle float/wave and no
pointer parallax. These tests pin that contract so the animation cannot creep
back in unnoticed:

* the copy is real DOM text that reads "hi, i am Atul Rathod." and its
  ``aria-label`` matches it exactly, still as the same centred three-line block,
* no hero-text animation layer survives: no ``.hero-3d__*`` / ``.typing3d-*``
  markup, no hero-text animation script tags, no such files on disk and no
  animation CSS / motion tokens for the headline,
* the headline is never handed an animate.css entrance (nor the inline
  ``opacity: 0`` that gates it) and the static centring stays,
* the WebGL BACKGROUND (three.min.js / astra3d.js) is untouched and still
  ``defer``red, and no debug/scratch screenshot path leaks into the source.

They are pure text assertions (no browser, no server) so they run anywhere.
Comments are stripped before scanning, so a comment that *documents* the removal
is fine - only live markup/CSS counts.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

INDEX_HTML = ROOT / "index.html"
STYLE_CSS = ROOT / "assets" / "css" / "style.css"
RESPONSIVE_CSS = ROOT / "assets" / "css" / "responsive.css"
JS_DIR = ROOT / "assets" / "js"

#: The hero-text animation layers that were removed on purpose.
REMOVED_SCRIPTS = ("hero3d.js", "typing3d.js")

#: Tokens that only ever existed to drive the removed hero animation layer.
ANIMATION_TOKENS = ("hero-3d", "typing3d", "--t3d-", "--tl-")

#: The copy the user reads, exactly as authored.
VISIBLE_COPY = "hi, i am Atul Rathod."

#: Motion properties a static headline rule may never declare.
MOTION_PROPS = re.compile(r"(?:^|[;\s])(animation|transition|transform|will-change)\s*:")

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


def _strip_comments(text: str) -> str:
    """Drop CSS and HTML comments (their prose may name the removed layers)."""
    text = re.sub(r"/\*[\s\S]*?\*/", " ", text)
    return re.sub(r"<!--[\s\S]*?-->", " ", text)


def _strip_reduced_motion(css: str) -> str:
    """Drop `@media (prefers-reduced-motion: reduce)` blocks.

    A reduced-motion block can only ever *remove* motion, so it can never make
    the headline animated; excluding it keeps this contract about the default
    state.
    """
    out = []
    i = 0
    while True:
        j = css.find("@media", i)
        if j == -1:
            out.append(css[i:])
            return "".join(out)
        k = css.find("{", j)
        if k == -1:
            out.append(css[i:])
            return "".join(out)
        if "prefers-reduced-motion" not in css[j:k]:
            out.append(css[i:k + 1])
            i = k + 1
            continue
        depth, m = 1, k + 1
        while m < len(css) and depth:
            if css[m] == "{":
                depth += 1
            elif css[m] == "}":
                depth -= 1
            m += 1
        out.append(css[i:j])
        i = m


def _css_rules(css: str):
    """Yield ``(selector, body)`` for every rule (one entry per selector)."""
    css = _strip_comments(css)
    rules = []
    for selector, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        for part in selector.split(","):
            part = part.strip()
            if part:
                rules.append((part, body))
    return rules


def _script_tag(html: str, src: str) -> str:
    """Return the <script ...> opening tag whose src is *src* (last segment match)."""
    for tag in re.findall(r"<script\b[^>]*>", html, re.IGNORECASE):
        if re.search(r'src\s*=\s*["\'][^"\']*' + re.escape(src) + r'["\']', tag):
            return tag
    raise AssertionError("<script src=...%s> tag not found in index.html" % src)


def _hero_headline(html: str) -> str:
    """Return the hero headline block: ``<h2 class="hero-title"> ... </h2>``."""
    match = re.search(r'<h2 class="hero-title"[\s\S]*?</h2>', html)
    assert match, 'index.html must contain the hero <h2 class="hero-title"> headline'
    return match.group(0)


def _visible_text(headline: str) -> str:
    """The text a user actually reads in the headline block.

    Tags (including the ``<br>`` line breaks and the opening tag's attributes)
    collapse to a space, runs of whitespace collapse to one space and the space
    the markup inserts before the punctuation is dropped.
    """
    text = re.sub(r"<[^>]+>", " ", headline)
    text = re.sub(r"\s+([,.])", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


# --------------------------------------------------------------------------- #
# the headline itself
# --------------------------------------------------------------------------- #
def test_headline_is_a_semantic_h2_with_plain_static_text():
    """`<h2 class="hero-title">` must survive as plain text markup.

    No per-glyph/per-word animation wrappers (``.hero-3d__*``) and no inline
    motion custom properties (``--i`` / ``--j`` / ``--d``) may come back: the
    headline is text, not a stage.
    """
    headline = _hero_headline(_read(INDEX_HTML))

    assert "hero-3d" not in headline, (
        "the static headline must not use the removed .hero-3d__* glyph markup"
    )
    assert "typing3d" not in headline
    assert not re.search(r'style\s*=\s*["\']\s*--(i|j|d)\s*:', headline), (
        "the static headline must not carry the per-word/per-letter motion "
        "custom properties (--i / --j / --d)"
    )
    assert not re.search(r"data-text\s*=", headline), (
        "the copy must be real text nodes, not an attribute-driven pseudo layer"
    )


def test_headline_reads_hi_i_am_atul_rathod():
    """The settled, visible copy must still be "hi, i am Atul Rathod."."""
    visible = _visible_text(_hero_headline(_read(INDEX_HTML)))

    assert visible == VISIBLE_COPY, (
        "the hero headline must read %r (got %r)" % (VISIBLE_COPY, visible)
    )
    assert "i am Atul Rathod" in visible


def test_headline_aria_label_matches_the_visible_copy():
    """The accessible name must match the visible copy exactly."""
    headline = _hero_headline(_read(INDEX_HTML))
    label = re.search(r'aria-label="([^"]*)"', headline)

    assert label, "the hero headline must keep its aria-label"
    assert label.group(1) == VISIBLE_COPY, (
        "the accessible name must match the visible copy (got %r)"
        % (label.group(1) if label else None)
    )


def test_headline_keeps_the_centred_three_line_block():
    """The authored line structure ("hi, i am" / "Atul" / "Rathod .") survives.

    Two ``<br>``s = three lines, and nothing transforms the heading inline.
    """
    headline = _hero_headline(_read(INDEX_HTML))

    assert len(re.findall(r"<br\s*/?>", headline)) == 2, (
        "the headline must keep its three authored lines (two <br> breaks)"
    )
    assert "transform" not in headline, (
        "the static headline must not be transformed inline"
    )


# --------------------------------------------------------------------------- #
# the animation layers are gone
# --------------------------------------------------------------------------- #
def test_index_no_longer_loads_hero_text_animation_scripts():
    """The per-letter entrance/parallax script and the WebGL typed-character
    overlay script must not be referenced or loaded any more."""
    html = _read(INDEX_HTML)

    for src in REMOVED_SCRIPTS:
        assert not re.search(
            r'<script\b[^>]*src\s*=\s*["\'][^"\']*' + re.escape(src) + r'["\']',
            html,
            re.IGNORECASE,
        ), "index.html must not load %s as a script" % src


def test_hero_text_animation_scripts_are_deleted():
    """The removed layers must not survive as dead files (a stale copy could be
    re-tagged into the page by accident)."""
    for src in REMOVED_SCRIPTS:
        assert not (JS_DIR / src).exists(), (
            "assets/js/%s must be deleted: it only ever animated the hero text" % src
        )


def test_index_has_no_hero_animation_hooks_left():
    """No `.hero-3d__*` / `.typing3d-*` hook may remain in the live markup."""
    live = _strip_comments(_read(INDEX_HTML))

    for token in ANIMATION_TOKENS:
        assert token not in live, (
            "index.html still contains the removed hero-animation token %r" % token
        )


def test_style_css_has_no_hero_text_animation_left():
    """style.css must not define the removed glyph rules, keyframes or tokens."""
    css = _strip_comments(_read(STYLE_CSS))

    for token in ANIMATION_TOKENS:
        assert token not in css, (
            "style.css still contains the removed hero-animation token %r" % token
        )
    for name in ("hero-3d", "hero-pulse", "typing3d"):
        assert not re.search(r"@keyframes\s+%s\b" % re.escape(name), css), (
            "style.css still defines the removed @keyframes %s" % name
        )


def test_style_css_keeps_the_headline_rules_static():
    """Every rule that targets the headline may only set static paint/type.

    No ``animation``, ``transition``, ``transform``/``transform-style`` or
    ``will-change`` may be attached to `.hero-title` / `.header-text h2` (the
    dedicated paint-only ``.hero-name`` rule and the `.animated` neutraliser are
    checked separately).
    """
    css = _strip_reduced_motion(_read(STYLE_CSS))
    offenders = []

    for selector, body in _css_rules(css):
        if selector != ".hero-title" and "header-text h2" not in selector:
            continue
        if ".hero-name" in selector or ".animated" in selector:
            continue
        for match in MOTION_PROPS.finditer(body):
            offenders.append("%s { %s }" % (selector, match.group(1)))

    assert not offenders, (
        "the headline rules must stay static (no animation/transform): %s"
        % "; ".join(offenders)
    )


def test_style_css_keeps_the_static_headline_centring():
    """The centring fix must survive: `.hero-title` owns the centred line box."""
    rules = dict(_css_rules(_strip_reduced_motion(_read(STYLE_CSS))))

    hero_title = rules.get(".hero-title")
    assert hero_title is not None, "style.css must keep the `.hero-title` rule"
    assert re.search(r"display:\s*block", hero_title), (
        "`.hero-title` must stay a block so all three lines share one centred axis"
    )
    assert re.search(r"text-align:\s*center", hero_title), (
        "`.hero-title` must stay centred"
    )

    name = next((body for sel, body in rules.items() if ".hero-name" in sel), None)
    assert name is not None, (
        "style.css must keep the paint-only `.hero-title .hero-name` gradient rule"
    )
    assert "background-clip" in name and "linear-gradient" in name
    assert not MOTION_PROPS.search(name), (
        "the name gradient is PAINT ONLY - it must not animate or transform"
    )


def test_style_css_cancels_the_template_headline_entrance():
    """The template's own hero entrance still hands `.header-text h2` an
    animate.css `fadeInUp` plus an inline `opacity: 0`; style.css must cancel
    both, so the headline is painted immediately and can never be left
    invisible if the animation does not run."""
    css = _strip_comments(_read(STYLE_CSS))
    match = re.search(r"\.header-text h2\.animated\s*\{([^}]*)\}", css)

    assert match, (
        "style.css must keep the `.header-text h2.animated` neutraliser for the "
        "template's fadeInUp entrance"
    )
    body = match.group(1)
    assert re.search(r"animation:\s*none\s*!important", body), (
        "the neutraliser must switch the entrance animation off"
    )
    assert re.search(r"opacity:\s*1\s*!important", body), (
        "the neutraliser must release the inline opacity: 0 (it must beat the "
        "inline style, hence !important)"
    )


# --------------------------------------------------------------------------- #
# the responsive overrides + the background that must survive
# --------------------------------------------------------------------------- #
def test_responsive_css_has_no_hero_text_animation_left():
    css = _strip_comments(_read(RESPONSIVE_CSS))

    for token in ANIMATION_TOKENS:
        assert token not in css, (
            "responsive.css still contains the removed hero-animation token %r" % token
        )
    assert "perspective" not in css, (
        "responsive.css must not re-open a 3-D perspective stage for the headline"
    )

    phone_h2 = next(
        (
            body
            for sel, body in _css_rules(_strip_reduced_motion(css))
            if sel == "header-text h2" or sel == ".header-text h2"
        ),
        None,
    )
    assert phone_h2 is not None, (
        "responsive.css must keep its phone `.header-text h2` override"
    )
    assert re.search(r"text-align:\s*center", phone_h2), (
        "the headline must stay centred on phones too"
    )


def test_background_webgl_scripts_are_still_deferred():
    """Only the hero TEXT animation was removed - the 3-D background stage is
    untouched, and both of its scripts stay deferred so they never block paint."""
    html = _read(INDEX_HTML)

    for src in ("three.min.js", "astra3d.js"):
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
