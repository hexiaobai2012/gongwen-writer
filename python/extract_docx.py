# -*- coding: utf-8 -*-
"""Extract paragraphs from a .docx for gongwen-writer import."""
import json
import sys
from pathlib import Path

from docx import Document


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: extract_docx.py file.docx"}))
        return 1
    doc = Document(sys.argv[1])
    paragraphs = []
    for p in doc.paragraphs:
        text = (p.text or "").strip()
        if not text:
            continue
        tabs = []
        try:
            for ts in p.paragraph_format.tab_stops:
                tabs.append({"pos": round(ts.position.pt, 2), "align": str(ts.alignment)})
        except Exception:
            pass
        paragraphs.append(
            {
                "text": text,
                "style": p.style.name if p.style else "",
                "tabs": tabs,
            }
        )
    print(json.dumps({"ok": True, "paragraphs": paragraphs}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
