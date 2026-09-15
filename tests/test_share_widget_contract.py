"""Contract tests for the LinkedIn share button in the slideable Share widget.

Runtime verification caught the real, user-visible bug: clicking LinkedIn opened
an EMPTY panel (no title / image / URL preview) while X / Facebook / WhatsApp all
worked. Root cause: jsSocials 1.5.0's built-in LinkedIn network builds the
DEPRECATED endpoint

    https://www.linkedin.com/shareArticle?mini=true&url={url}

which LinkedIn no longer honors. The modern endpoint only takes a `url` parameter:

    https://www.linkedin.com/sharing/share-offsite/?url={encodedUrl}

Because jsSocials is a CDN-loaded third party we can't patch it directly; custom.js
therefore overrides the LinkedIn network with an inline custom share entry whose
`shareUrl` builds the modern endpoint. Pure text assertions (no browser, no server),
in the same style as the nav-scroll and API contracts: CSS/JS comments are stripped
before scanning so a comment that *documents* the old behaviour stays legal — only
live code counts.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CUSTOM_JS = ROOT / "assets" / "js" / "custom.js"

#: jsSocials' built-in (deprecated) LinkedIn share URL — must never be live code.
DEPRECATED_LINKEDIN_URL = "www.linkedin.com/shareArticle"
#: The modern LinkedIn off-site share endpoint required by LinkedIn today.
MODERN_LINKEDIN_URL = "linkedin.com/sharing/share-offsite"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _strip_comments(text: str) -> str:
    """Drop ``/* ... */``, ``//`` and ``<!-- ... -->`` comments."""
    text = re.sub(r"/\*[\s\S]*?\*/", " ", text)
    text = re.sub(r"<!--[\s\S]*?-->", " ", text)
    return re.sub(r"(?m)^\s*//.*$", " ", text)


def _live_js() -> str:
    """custom.js with its comments removed — only live code remains."""
    return _strip_comments(_read(CUSTOM_JS))


def test_linkedin_uses_modern_offsite_endpoint():
    """The LinkedIn share must target the modern ``sharing/share-offsite`` URL."""
    live = _live_js()
    assert MODERN_LINKEDIN_URL in live, (
        "custom.js must open the modern LinkedIn off-site share endpoint "
        "(%s) so the share panel shows real content"
        % ("https://" + MODERN_LINKEDIN_URL)
    )


def test_deprecated_sharearticle_endpoint_is_gone():
    """The deprecated ``shareArticle?mini=true`` endpoint must not be built in live code."""
    live = _live_js()
    assert DEPRECATED_LINKEDIN_URL not in live, (
        "custom.js must no longer rely on jsSocials' built-in LinkedIn handler, "
        "which builds the deprecated %s endpoint that opens an empty panel"
        % ("https://" + DEPRECATED_LINKEDIN_URL)
    )


def test_linkedin_entry_is_overridden_on_the_linkedin_share():
    """The LinkedIn override must hang off the ``linkedin`` share so the button keeps
    jsSocials' ``jssocials-share-linkedin`` styling and the blue .share-widget colour."""
    live = _live_js()
    linkedin_block = re.search(
        r"share:\s*['\"]linkedin['\"][\s\S]*?shareUrl\s*:",
        live,
    )
    assert linkedin_block is not None, (
        "the LinkedIn entry in the shares array must carry a custom shareUrl "
        "that overrides jsSocials' built-in handler"
    )


def test_linkedin_label_preserved():
    """The LinkedIn button keeps its label so the flat theme still renders text."""
    live = _live_js()
    assert re.search(r"label:\s*['\"]LinkedIn['\"]", live), (
        "the LinkedIn share entry must keep label 'LinkedIn'"
    )
