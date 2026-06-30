#!/usr/bin/env python3
"""Static cross-platform checks for menu squiggly ripple integration."""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "index.html"
STYLE = ROOT / "style.css"


class MenuParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[str] = []
        self.filter_ids: list[str] = []
        self.menu_squiggly_depth: int | None = None
        self.menu_shell_depth: int | None = None
        self.pizza_in_squiggly = False
        self.contain_in_squiggly = False
        self.menu_subtitle_in_squiggly = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = dict(attrs)
        cls = attrs_dict.get("class", "") or ""
        classes = cls.split()

        if tag == "filter" and attrs_dict.get("id", "").startswith("menu-squiggly-"):
            self.filter_ids.append(attrs_dict["id"])

        if "menu-shell" in classes:
            self.menu_shell_depth = len(self.stack)

        if "menu-squiggly" in classes:
            self.menu_squiggly_depth = len(self.stack)

        if self.menu_squiggly_depth is not None and len(self.stack) >= self.menu_squiggly_depth:
            if "pizza-box" in classes or tag == "article" and "contain" in classes:
                if "pizza-box" in classes:
                    self.pizza_in_squiggly = True
                if "contain" in classes:
                    self.contain_in_squiggly = True
            if "menu-subtitle" in classes:
                self.menu_subtitle_in_squiggly = True

        self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def main() -> int:
    html = read(INDEX)
    css = read(STYLE)
    parser = MenuParser()
    parser.feed(html)

    failures: list[str] = []

    if parser.filter_ids != [
        "menu-squiggly-0",
        "menu-squiggly-1",
        "menu-squiggly-2",
        "menu-squiggly-3",
        "menu-squiggly-4",
    ]:
        failures.append(f"Expected 5 menu squiggly filters, got {parser.filter_ids}")

    if 'class="menu-squiggly"' not in html:
        failures.append("Missing .menu-squiggly wrapper in HTML")

    if parser.menu_subtitle_in_squiggly is False:
        failures.append("Menu text is not inside .menu-squiggly wrapper")

    if parser.pizza_in_squiggly:
        failures.append("Pizza box must stay outside squiggly wrapper")

    if parser.contain_in_squiggly:
        failures.append("Site background must stay outside squiggly wrapper")

    required_css = [
        r"\.menu-squiggly\s*\{",
        r"@keyframes menu-squiggly-anim",
        r"@-webkit-keyframes menu-squiggly-anim",
        r'filter: url\("#menu-squiggly-0"\)',
        r"-webkit-filter: url\(\"#menu-squiggly-0\"\)",
        r"@media \(prefers-reduced-motion: reduce\)",
    ]
    for pattern in required_css:
        if not re.search(pattern, css):
            failures.append(f"Missing CSS: {pattern}")

    if re.search(r"\.contain[^{]*\{[^}]*animation:[^;]*menu-squiggly", css, re.S):
        failures.append("Site background must not use menu squiggly animation")

    if re.search(r"\.pizza-box[^{]*\{[^}]*filter:", css, re.S):
        failures.append("Pizza box must not use CSS filter")

    if "feTurbulence" not in html or "feDisplacementMap" not in html:
        failures.append("SVG turbulence/displacement filters missing from index.html")

    # parity with ripple demo timing
    if "0.4s infinite" not in css:
        failures.append("Squiggly animation should use 0.4s infinite like ripple demo")

    ios_notes = {
        "webkit-keyframes": "@-webkit-keyframes menu-squiggly-anim" in css,
        "webkit-filter": "-webkit-filter: url(\"#menu-squiggly-" in css,
        "translateZ": "translateZ(0)" in css,
        "overflow_scrolling": "-webkit-overflow-scrolling: touch" in css,
    }

    print("Menu squiggly integration checks")
    print("================================")
    for name, ok in ios_notes.items():
        print(f"{'PASS' if ok else 'WARN'} iOS-oriented: {name}")

    if failures:
        print("\nFAILURES")
        for item in failures:
            print(f"  - {item}")
        return 1

    print("\nPASS structural checks")
    print("PASS ripple technique preserved (SVG feTurbulence + feDisplacementMap, 0.4s cycle)")
    print("PASS menu-only scope (background tile + pizza untouched)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
