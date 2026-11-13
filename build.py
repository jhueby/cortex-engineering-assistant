#!/usr/bin/env python3
"""Inline bookmarklet.js into install.html and package the shareable zip.

Usage:
    python3 build.py              # inline + syntax check
    python3 build.py --zip        # also write dist/cortex-engineering-assistant.zip
    python3 build.py --zip PATH   # write the zip somewhere else
"""

import json
import pathlib
import shutil
import subprocess
import sys
import zipfile

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "bookmarklet.js"
PAGE = ROOT / "install.html"
TITLE = "Cortex Engineering Assistant"


def syntax_check(source):
    """Run node --check if node is available. Returns None if it can't run."""
    if shutil.which("node") is None:
        return None
    result = subprocess.run(
        ["node", "--check", "-"],
        input=source.replace("javascript:", "", 1),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise SystemExit("Syntax error in bookmarklet.js:\n" + result.stderr)
    return True


def inline(minified):
    """Replace the whole <script> block in install.html with a fresh one.

    Rewriting the entire block (rather than regexing the assignment) avoids
    matching a semicolon inside the bookmarklet string, which silently
    truncates it.
    """
    html = PAGE.read_text()
    start = html.find("<script>")
    end = html.find("</script>") + len("</script>")
    if start < 0 or end < len("</script>"):
        raise SystemExit("Could not find the <script> block in install.html")

    block = (
        "<script>\n"
        f"    var BOOKMARKLET = {json.dumps(minified)};\n"
        '    document.getElementById("bookmarklet-link").href = BOOKMARKLET;\n'
        f'    document.getElementById("bookmarklet-link").textContent = "{TITLE}";\n'
        '    document.getElementById("manual-code").textContent = BOOKMARKLET;\n'
        "  </script>"
    )
    PAGE.write_text(html[:start] + block + html[end:])


def verify():
    """Re-read install.html and confirm the inlined string round-trips."""
    html = PAGE.read_text()
    marker = "var BOOKMARKLET = "
    start = html.find(marker) + len(marker)
    i = start + 1
    while i < len(html):
        if html[i] == "\\":
            i += 2
        elif html[i] == '"':
            break
        else:
            i += 1
    return json.loads(html[start:i + 1])


def main():
    source = SRC.read_text()
    checked = syntax_check(source)

    minified = " ".join(source.split())
    inline(minified)

    if verify() != minified:
        raise SystemExit("Verification failed: install.html does not round-trip")

    print(f"bookmarklet.js  {len(minified):,} chars"
          f"{'  (node --check passed)' if checked else '  (node not found, skipped check)'}")
    print(f"install.html    {len(PAGE.read_text()):,} chars")

    if "--zip" in sys.argv:
        pos = sys.argv.index("--zip")
        tail = sys.argv[pos + 1:]
        target = pathlib.Path(tail[0]).expanduser() if tail else ROOT / "dist" / "cortex-engineering-assistant.zip"
        if target.is_dir():
            target = target / "cortex-engineering-assistant.zip"
        target.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(PAGE, "install.html")
        print(f"zip             {target}  ({target.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
