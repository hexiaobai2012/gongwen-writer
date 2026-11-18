# -*- coding: utf-8 -*-
"""gongwen-writer 内置公文渲染与检查器（只依赖 python-docx）。

用法：
  python render_docx.py render input.json
  python render_docx.py check  file.docx
  python render_docx.py probe

版式口径：
  页边距 上37mm、下35mm、左28mm、右26mm；
  全文行距固定28磅，段前段后均为0；
  标题二号方正小标宋简体不加粗、居中；
  正文三号仿宋_GB2312，首行缩进2字符；
  一级标题三号黑体，二级标题三号楷体_GB2312；
  页码“- 1 -”四号仿宋_GB2312，奇数页右下、偶数页左下；
  落款首行右空4字符，日期及续行以落款首行中心对齐。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Mm, Pt

BODY_FONT = "仿宋_GB2312"
TITLE_FONT = "方正小标宋简体"
H1_FONT = "黑体"
H2_FONT = "楷体_GB2312"
PAGE_FONT = BODY_FONT

# GB/T 9704-2012：A4，版心 156mm×225mm。
MARGIN_TOP_MM = 37.0
MARGIN_BOTTOM_MM = 35.0
MARGIN_LEFT_MM = 28.0
MARGIN_RIGHT_MM = 26.0
BODY_PT = 16.0
LINE_PT = 28.0
TITLE_PT = 22.0
FIRST_INDENT_CHARS = 2.0
PAGE_PT = 14.0
SIGNATURE_RIGHT_CHARS = 4.0
FOOTER_DISTANCE_MM = 28.0

DATE_RE = re.compile(r"20\d{2}年\d{1,2}月\d{1,2}日")
H1_RE = re.compile(r"^[一二三四五六七八九十百]+、")
H2_RE = re.compile(r"^（[一二三四五六七八九十百]+）")
SALUTATION_EXCLUDE_RE = re.compile(r"如下|以下|事项|特此|此复|此致|附件|通知如下|报告如下|说明如下|安排如下|要求如下")


def _is_salutation(text: str) -> bool:
    """发言稿/函件称呼：各位同学：、县应急管理局：，应顶格。"""
    t = str(text or "").strip()
    if not t or len(t) > 40 or not t.endswith(("：", ":")):
        return False
    body = t[:-1]
    if re.search(r"[。；]", body):
        return False
    if SALUTATION_EXCLUDE_RE.search(t):
        return False
    if re.match(r"^(?:各位|同志们|朋友们|老师们|同学们|女士们|先生们|来宾们|亲爱的)", t):
        return True
    return bool(re.match(r"^[\u4e00-\u9fa5A-Za-z0-9（）()、，, ]{2,40}[：:]$", t))


def _looks_like_heading(text: str) -> bool:
    """与 lib/util.js 的 inferRole 保持一致：短、无句号/分号才算标题。"""
    return len(text) <= 40 and not re.search(r"[。；]", text)

# 自动断行时尽量不拆开的常见单位名称。
PROTECTED_WORDS = sorted(
    {
        "办公室",
        "委员会",
        "工作专班办公室",
        "工作专班",
        "专班",
        "管理局",
        "自然资源局",
        "人民政府",
        "有限公司",
        "有限责任公司",
        "党支部",
        "党总支",
        "党委",
        "党组",
        "人民法院",
        "人民检察院",
        "发展和改革委员会",
        "教育局",
        "公安局",
        "财政局",
        "人力资源和社会保障局",
        "住房和城乡建设局",
        "交通运输局",
        "水利局",
        "农业农村局",
        "商务局",
        "文化和旅游局",
        "卫生健康委员会",
        "应急管理局",
        "审计局",
        "市场监督管理局",
        "统计局",
        "医疗保障局",
        "税务局",
        "生态环境局",
        "自然资源和规划局",
        "综合行政执法局",
        "行政审批服务局",
        "机关事务管理局",
    },
    key=len,
    reverse=True,
)


def _set_run_font(run, name: str, size_pt: float, bold: bool = False, ascii_name: str | None = None):
    """同时设置中文、西文、复杂文种字体，避免数字/英文回落到 Times New Roman。"""
    run.font.name = name
    run.font.size = Pt(size_pt)
    run.bold = bold
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), ascii_name or name)
    rfonts.set(qn("w:hAnsi"), ascii_name or name)
    rfonts.set(qn("w:eastAsia"), name)
    rfonts.set(qn("w:cs"), name)


def _set_indent(para, *, first_chars: float = 0.0, left_pt: float = 0.0, right_pt: float = 0.0):
    pf = para.paragraph_format
    pf.left_indent = Pt(left_pt)
    pf.right_indent = Pt(right_pt)
    ppr = para._p.get_or_add_pPr()
    try:
        ind = ppr.get_or_add_ind()
    except AttributeError:
        ind = ppr.find(qn("w:ind"))
        if ind is None:
            ind = OxmlElement("w:ind")
            ppr.append(ind)
    if first_chars:
        ind.set(qn("w:firstLineChars"), str(int(round(first_chars * 100))))
        ind.set(qn("w:firstLine"), str(int(round(first_chars * BODY_PT * 20))))
    else:
        if ind.get(qn("w:firstLineChars")) is not None:
            del ind.attrib[qn("w:firstLineChars")]
        ind.set(qn("w:firstLine"), "0")


def _para_format(
    para,
    *,
    align: str = "justify",
    first_chars: float = 0.0,
    left_pt: float = 0.0,
    right_pt: float = 0.0,
):
    pf = para.paragraph_format
    pf.alignment = {
        "left": WD_ALIGN_PARAGRAPH.LEFT,
        "center": WD_ALIGN_PARAGRAPH.CENTER,
        "right": WD_ALIGN_PARAGRAPH.RIGHT,
        "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
    }.get(align, WD_ALIGN_PARAGRAPH.JUSTIFY)
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)
    pf.line_spacing = Pt(LINE_PT)
    pf.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    _set_indent(para, first_chars=first_chars, left_pt=left_pt, right_pt=right_pt)


def _add_text_para(
    doc,
    text,
    *,
    font=BODY_FONT,
    size=BODY_PT,
    bold=False,
    align="justify",
    first_chars=FIRST_INDENT_CHARS,
    ascii_font=None,
):
    p = doc.add_paragraph()
    _para_format(p, align=align, first_chars=first_chars)
    r = p.add_run(str(text))
    _set_run_font(r, font, size, bold, ascii_name=ascii_font)
    return p


def _add_blank(doc, count=1):
    for _ in range(count):
        p = doc.add_paragraph()
        _para_format(p, align="left", first_chars=0)
        r = p.add_run("")
        _set_run_font(r, BODY_FONT, BODY_PT)


def _add_ai_declaration(doc):
    p = doc.add_paragraph()
    _para_format(p, align="center", first_chars=0)
    r = p.add_run("（内容由AI辅助生成，仅供参考）")
    _set_run_font(r, "楷体_GB2312", 9)


def _add_page_field(paragraph):
    prefix = paragraph.add_run("- ")
    _set_run_font(prefix, PAGE_FONT, PAGE_PT)

    def field_run():
        run = paragraph.add_run()
        _set_run_font(run, PAGE_FONT, PAGE_PT)
        return run

    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    field_run()._r.append(fld_begin)

    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    field_run()._r.append(instr)

    fld_sep = OxmlElement("w:fldChar")
    fld_sep.set(qn("w:fldCharType"), "separate")
    field_run()._r.append(fld_sep)

    result = paragraph.add_run("1")
    _set_run_font(result, PAGE_FONT, PAGE_PT)

    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    field_run()._r.append(fld_end)
    suffix = paragraph.add_run(" -")
    _set_run_font(suffix, PAGE_FONT, PAGE_PT)


def _body_width_pt(section) -> float:
    return section.page_width.pt - section.left_margin.pt - section.right_margin.pt


def _text_width_pt(text: str, size: float = BODY_PT) -> float:
    """按中文全角、西文半角估算文本宽度（三号字 1 个汉字 16 磅）。"""
    total = 0.0
    for ch in text:
        total += size * (0.5 if ord(ch) < 128 else 1.0)
    return total


def _bad_break(text: str, pos: int) -> bool:
    if pos <= 0 or pos >= len(text):
        return True
    for word in PROTECTED_WORDS:
        start = text.find(word)
        while start != -1:
            if start < pos < start + len(word):
                return True
            start = text.find(word, start + 1)
    if text[pos - 1] in "的与和及或、，。；：":
        return True
    if text[pos] in "、，。；：）】》”’":
        return True
    return False


def _auto_split_issuer(text: str, max_first_chars: int, body_width: float) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_first_chars:
        return [text]

    # 优先在括号前断开，例如“单位全称（下属机构）”，避免把“工作专班办公室”拆开。
    for mark in ("（", "("):
        idx = text.find(mark)
        if 0 < idx <= max_first_chars:
            first_width = _text_width_pt(text[:idx])
            center = body_width - SIGNATURE_RIGHT_CHARS * BODY_PT - first_width / 2
            max_center_width = 2 * min(center, body_width - center)
            if _text_width_pt(text[idx:]) <= max_center_width - 2:
                return [text[:idx], text[idx:]]

    n = len(text)
    k = (n + max_first_chars - 1) // max_first_chars
    base, rem = divmod(n, k)
    targets = [base + (1 if i < rem else 0) for i in range(k)]
    lines: list[str] = []
    pos = 0
    for target in targets[:-1]:
        desired = pos + target
        lo = max(pos + 1, desired - 3)
        hi = min(n - 1, pos + max_first_chars, desired + 3)
        candidates = sorted(range(lo, hi + 1), key=lambda x: (abs(x - desired), x))
        chosen = next((c for c in candidates if not _bad_break(text, c)), desired)
        lines.append(text[pos:chosen])
        pos = chosen
    lines.append(text[pos:])
    return [line for line in lines if line]


def _issuer_lines(issuer: str, body_width: float) -> list[str]:
    """落款单位可按换行符手工断行；过长时自动均衡断行，并避开常见单位名称。"""
    raw = [x.strip() for x in re.split(r"[\r\n]+", issuer) if x.strip()]
    if not raw:
        return []
    max_first_chars = max(1, int((body_width - SIGNATURE_RIGHT_CHARS * BODY_PT) // BODY_PT))
    lines: list[str] = []
    for line in raw:
        lines.extend(_auto_split_issuer(line, max_first_chars, body_width))

    if len(lines) > 1:
        first_width = _text_width_pt(lines[0])
        center = body_width - SIGNATURE_RIGHT_CHARS * BODY_PT - first_width / 2
        max_center_width = 2 * min(center, body_width - center)
        if any(_text_width_pt(line) > max_center_width - 2 for line in lines[1:]):
            lines = _auto_split_issuer("".join(raw), max_first_chars, body_width)
    return lines


def _add_tabbed_run(paragraph, text: str):
    tab = paragraph.add_run("\t")
    _set_run_font(tab, BODY_FONT, BODY_PT)
    run = paragraph.add_run(text)
    _set_run_font(run, BODY_FONT, BODY_PT)


def _add_signature(doc, issuer: str, date: str, body_width: float):
    """落款首行右空四字；日期和单位续行以首行中心对齐。"""
    lines = _issuer_lines(issuer, body_width) if issuer else []
    right_tab = body_width - SIGNATURE_RIGHT_CHARS * BODY_PT
    center = None

    if lines:
        first_width = _text_width_pt(lines[0])
        center = right_tab - first_width / 2
        center = min(max(center, 0.0), body_width)

        p = doc.add_paragraph()
        _para_format(p, align="left", first_chars=0)
        p.paragraph_format.tab_stops.add_tab_stop(Pt(right_tab), WD_TAB_ALIGNMENT.RIGHT)
        _add_tabbed_run(p, lines[0])

        for line in lines[1:]:
            p = doc.add_paragraph()
            _para_format(p, align="left", first_chars=0)
            p.paragraph_format.tab_stops.add_tab_stop(Pt(center), WD_TAB_ALIGNMENT.CENTER)
            _add_tabbed_run(p, line)

    if date:
        p = doc.add_paragraph()
        _para_format(p, align="left", first_chars=0)
        if center is not None:
            p.paragraph_format.tab_stops.add_tab_stop(Pt(center), WD_TAB_ALIGNMENT.CENTER)
        else:
            p.paragraph_format.tab_stops.add_tab_stop(Pt(right_tab), WD_TAB_ALIGNMENT.RIGHT)
        _add_tabbed_run(p, date)


def _configure_page(doc):
    section = doc.sections[0]
    section.page_width = Mm(210)
    section.page_height = Mm(297)
    section.top_margin = Mm(MARGIN_TOP_MM)
    section.bottom_margin = Mm(MARGIN_BOTTOM_MM)
    section.left_margin = Mm(MARGIN_LEFT_MM)
    section.right_margin = Mm(MARGIN_RIGHT_MM)
    section.header_distance = Cm(1.5)
    section.footer_distance = Mm(FOOTER_DISTANCE_MM)

    # 奇偶页不同页脚。
    try:
        doc.settings.odd_and_even_pages_header_footer = True
    except Exception:
        settings = doc.settings.element
        if settings.find(qn("w:evenAndOddHeaders")) is None:
            settings.append(OxmlElement("w:evenAndOddHeaders"))

    # 页码从 1 开始。
    sect_pr = section._sectPr
    if sect_pr.find(qn("w:pgNumType")) is None:
        pg = OxmlElement("w:pgNumType")
        pg.set(qn("w:start"), "1")
        anchor = sect_pr.find(qn("w:cols"))
        if anchor is None:
            anchor = sect_pr.find(qn("w:docGrid"))
        if anchor is not None:
            anchor.addprevious(pg)
        else:
            sect_pr.append(pg)

    # 默认样式：三号仿宋、28磅固定行距、无段前段后。
    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(BODY_PT)
    if normal.element.rPr is not None and normal.element.rPr.rFonts is not None:
        normal.element.rPr.rFonts.set(qn("w:eastAsia"), BODY_FONT)
        normal.element.rPr.rFonts.set(qn("w:ascii"), BODY_FONT)
        normal.element.rPr.rFonts.set(qn("w:hAnsi"), BODY_FONT)
        normal.element.rPr.rFonts.set(qn("w:cs"), BODY_FONT)
    normal.paragraph_format.line_spacing = Pt(LINE_PT)
    normal.paragraph_format.line_spacing_rule = WD_LINE_SPACING.EXACTLY
    normal.paragraph_format.space_before = Pt(0)
    normal.paragraph_format.space_after = Pt(0)

    # 页脚：奇数页右下、偶数页左下；四号仿宋，行距同样28磅。
    section.footer.is_linked_to_previous = False
    section.even_page_footer.is_linked_to_previous = False
    odd = section.footer.paragraphs[0]
    _para_format(odd, align="right", first_chars=0)
    _add_page_field(odd)
    even = section.even_page_footer.paragraphs[0]
    _para_format(even, align="left", first_chars=0)
    _add_page_field(even)


def render(payload: dict):
    output = Path(payload["output"])
    output.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    _configure_page(doc)
    section = doc.sections[0]
    body_width = _body_width_pt(section)

    title = str(payload.get("title") or "").strip()
    recipient = str(payload.get("recipient") or "").strip()
    issuer = str(payload.get("issuer") or "").strip()
    date = str(payload.get("date") or "").strip()
    paragraphs = payload.get("paragraphs") or []
    options = payload.get("options") or {}
    is_speech = str(payload.get("docType") or "") in ("speech", "host_speech")

    if title:
        p = doc.add_paragraph()
        _para_format(p, align="center", first_chars=0)
        lines = [x.strip() for x in title.split("\n") if x.strip()]
        for i, line in enumerate(lines):
            if i:
                br = p.add_run()
                br.add_break()
                _set_run_font(br, TITLE_FONT, TITLE_PT)
            r = p.add_run(line)
            _set_run_font(r, TITLE_FONT, TITLE_PT, bold=False)
        _add_blank(doc, 1)

    if recipient and not is_speech:
        text = recipient if re.search(r"[：:]$", recipient) else f"{recipient}："
        _add_text_para(doc, text, first_chars=0)

    body_index = 0
    for item in paragraphs:
        if isinstance(item, str):
            text, role = item, "body"
        else:
            text, role = str(item.get("text") or ""), str(item.get("role") or "body")
        text = text.strip()
        if not text:
            continue
        is_first_body = body_index == 0
        body_index += 1
        if role == "salutation" or (is_first_body and _is_salutation(text)):
            _add_text_para(doc, text, first_chars=0)
        elif role == "heading1":
            _add_text_para(doc, text, font=H1_FONT, ascii_font=BODY_FONT)
        elif role == "heading2":
            _add_text_para(doc, text, font=H2_FONT, ascii_font=BODY_FONT)
        elif role in ("heading3", "heading4"):
            _add_text_para(doc, text, font=BODY_FONT, bold=True)
        elif role == "attachment":
            _add_text_para(doc, text)
        elif role == "signature":
            _add_signature(doc, text, "", body_width)
        elif role == "date":
            _add_signature(doc, "", text, body_width)
        else:
            _add_text_para(doc, text)

    if (issuer or date) and not is_speech:
        _add_blank(doc, 2)
        _add_signature(doc, issuer, date, body_width)

    if options.get("aiDeclaration"):
        _add_ai_declaration(doc)

    doc.core_properties.title = title or "公文"
    doc.core_properties.author = issuer or "gongwen-writer"
    doc.save(str(output))
    return {
        "ok": True,
        "output": str(output),
        "paragraphs": len(paragraphs),
        "title": title,
    }


# ---------------------------------------------------------------------------
# 格式检查
# ---------------------------------------------------------------------------


def _first_run(paragraph):
    for run in paragraph.runs:
        if run.text and run.text.strip():
            return run
    return paragraph.runs[0] if paragraph.runs else None


def _font_attr(run, attr: str) -> str:
    if run is None:
        return ""
    rpr = run._element.rPr
    if rpr is not None and rpr.rFonts is not None:
        value = rpr.rFonts.get(qn(f"w:{attr}"))
        if value:
            return value
    return ""


def _font_name(run):
    return _font_attr(run, "eastAsia") or (run.font.name if run is not None else "") or ""


def _ascii_font_name(run):
    return _font_attr(run, "ascii") or (run.font.name if run is not None else "") or ""


def _font_size(run):
    if run is None or run.font.size is None:
        return 0.0
    return round(run.font.size.pt, 1)


def _line_spacing_pt(paragraph):
    value = paragraph.paragraph_format.line_spacing
    if value is None:
        return None
    if hasattr(value, "pt"):
        return value.pt
    return float(value)


def _first_line_chars(paragraph):
    ppr = paragraph._p.pPr
    if ppr is None:
        return 0.0
    ind = ppr.find(qn("w:ind"))
    if ind is None:
        return 0.0
    chars = ind.get(qn("w:firstLineChars"))
    if chars:
        try:
            return int(chars) / 100.0
        except ValueError:
            pass
    twips = ind.get(qn("w:firstLine"))
    if twips:
        try:
            return int(twips) / 20.0 / BODY_PT
        except ValueError:
            pass
    return 0.0


def _tab_stops(paragraph):
    try:
        return [(ts.alignment, ts.position.pt) for ts in paragraph.paragraph_format.tab_stops]
    except Exception:
        return []


def _has_right_tab(paragraph, position: float) -> bool:
    return any(
        alignment == WD_TAB_ALIGNMENT.RIGHT and abs(pos - position) <= 1.5
        for alignment, pos in _tab_stops(paragraph)
    )


def _has_center_tab(paragraph, position: float) -> bool:
    return any(
        alignment == WD_TAB_ALIGNMENT.CENTER and abs(pos - position) <= 2.0
        for alignment, pos in _tab_stops(paragraph)
    )


def _is_ai_declaration(text: str) -> bool:
    return "AI辅助生成" in text or "仅供参考" in text


def check(path: str, doc_type: str = ""):
    doc = Document(path)
    issues = []
    section = doc.sections[0]
    body_width = _body_width_pt(section)
    right_tab = body_width - SIGNATURE_RIGHT_CHARS * BODY_PT
    strict_recipient = doc_type not in ("speech", "host_speech", "minutes")
    strict_date = doc_type not in ("speech", "host_speech")

    def add(severity, rule, message, location=""):
        issues.append({"severity": severity, "rule": rule, "message": message, "location": location})

    def check_spacing(paragraph, location, rule_prefix):
        ls = _line_spacing_pt(paragraph)
        if ls is None or abs(ls - LINE_PT) > 0.5:
            shown = "未设置" if ls is None else f"{ls:.1f}磅"
            add("P1", f"{rule_prefix}-001", f"行距{shown}，应为固定值28磅。", location)
        for label, value in (
            ("段前", paragraph.paragraph_format.space_before),
            ("段后", paragraph.paragraph_format.space_after),
        ):
            if value is not None and abs(value.pt) > 0.5:
                add("P2", f"{rule_prefix}-002", f"{label}间距 {value.pt:.1f}磅，应为0。", location)

    # 页面
    if abs(section.page_width.mm - 210) > 1 or abs(section.page_height.mm - 297) > 1:
        add("P0", "GW-PAGE-001", "纸张不是 A4（210mm×297mm）。", "页面设置")
    for label, value, expected in (
        ("上边距", section.top_margin.mm, MARGIN_TOP_MM),
        ("下边距", section.bottom_margin.mm, MARGIN_BOTTOM_MM),
        ("左边距", section.left_margin.mm, MARGIN_LEFT_MM),
        ("右边距", section.right_margin.mm, MARGIN_RIGHT_MM),
    ):
        if abs(value - expected) > 2:
            add("P1", "GW-PAGE-002", f"{label} {value:.0f}mm，国标参考 {expected:.0f}mm。", "页面设置")
    if abs(section.footer_distance.mm - FOOTER_DISTANCE_MM) > 3:
        add("P2", "GW-PAGE-004", f"页脚距边界 {section.footer_distance.mm:.0f}mm，建议 {FOOTER_DISTANCE_MM:.0f}mm（页码距版心下边缘约7mm）。", "页面设置")

    nonempty = [p for p in doc.paragraphs if p.text.strip()]
    if not nonempty:
        add("P0", "GW-BODY-001", "文档没有正文。", "全文")
        return {"ok": True, "issues": issues}

    # 标题
    title_p = nonempty[0]
    title_run = _first_run(title_p)
    title_text = title_p.text.strip()
    if title_p.alignment != WD_ALIGN_PARAGRAPH.CENTER:
        add("P1", "GW-TITLE-001", "标题未居中。", "标题")
    if abs(_font_size(title_run) - TITLE_PT) > 0.5:
        add("P1", "GW-TITLE-002", f"标题字号 {_font_size(title_run)}pt，应为二号（22pt）。", "标题")
    title_font = _font_name(title_run)
    if title_font != TITLE_FONT:
        add("P1", "GW-TITLE-003", f"标题字体为“{title_font or '未设置'}”，应为{TITLE_FONT}。", "标题")
    if title_run is not None and title_run.bold is True:
        add("P1", "GW-TITLE-005", "标题不应加粗。", "标题")
    if abs(_first_line_chars(title_p)) > 0.1:
        add("P2", "GW-TITLE-006", "标题不应首行缩进。", "标题")
    check_spacing(title_p, "标题", "GW-TITLE")

    # 主送机关
    recipient_idx = 1
    if len(nonempty) > 1 and nonempty[1].text.strip().endswith(("：", ":")):
        recipient_idx = 2
    elif strict_recipient:
        add("P1", "GW-RECIPIENT-001", "标题后未识别到主送机关（应以全角冒号结尾）。", "主送机关")

    # 成文日期位置
    date_idx = None
    for i, p in enumerate(nonempty):
        if DATE_RE.search(p.text):
            date_idx = i

    # 全文行距、段前段后
    for i, p in enumerate(nonempty[1:], start=1):
        if _is_ai_declaration(p.text):
            continue
        label = f"第{i + 1}段"
        check_spacing(p, label, "GW-LINE")

    # 正文、标题层级、落款字体
    for i, p in enumerate(nonempty[recipient_idx:], start=recipient_idx):
        text = p.text.strip()
        if _is_ai_declaration(text) or not text:
            continue
        run = _first_run(p)
        if run is None:
            continue
        font = _font_name(run)
        size = _font_size(run)
        location = f"第{i + 1}段"

        if _is_salutation(text):
            if "仿宋" not in font:
                add("P1", "GW-SALUT-001", f"称呼字体为“{font}”，应为仿宋_GB2312。", location)
            if abs(size - BODY_PT) > 0.5:
                add("P0", "GW-SALUT-002", f"称呼字号 {size}pt，应为三号（16pt）。", location)
            if abs(_first_line_chars(p)) > 0.1:
                add("P2", "GW-SALUT-003", "称呼应顶格，不能首行缩进。", location)
        elif _looks_like_heading(text) and H1_RE.match(text):
            if "黑体" not in font:
                add("P2", "GW-HEAD-001", f"一级标题字体为“{font}”，应为黑体。", location)
            if abs(size - BODY_PT) > 0.5:
                add("P1", "GW-HEAD-002", f"一级标题字号 {size}pt，应为三号（16pt）。", location)
            if abs(_first_line_chars(p) - FIRST_INDENT_CHARS) > 0.1:
                add("P2", "GW-HEAD-005", "一级标题首行缩进不是2字符。", location)
            if re.search(r"[A-Za-z0-9]", text) and "仿宋" not in _ascii_font_name(run):
                add("P2", "GW-HEAD-007", "一级标题中的数字/英文应为仿宋_GB2312。", location)
        elif _looks_like_heading(text) and H2_RE.match(text):
            if "楷体" not in font:
                add("P2", "GW-HEAD-003", f"二级标题字体为“{font}”，应为楷体_GB2312。", location)
            if abs(size - BODY_PT) > 0.5:
                add("P1", "GW-HEAD-004", f"二级标题字号 {size}pt，应为三号（16pt）。", location)
            if abs(_first_line_chars(p) - FIRST_INDENT_CHARS) > 0.1:
                add("P2", "GW-HEAD-006", "二级标题首行缩进不是2字符。", location)
            if re.search(r"[A-Za-z0-9]", text) and "仿宋" not in _ascii_font_name(run):
                add("P2", "GW-HEAD-008", "二级标题中的数字/英文应为仿宋_GB2312。", location)
        elif DATE_RE.search(text) or _tab_stops(p):
            if "仿宋" not in font:
                add("P2", "GW-SIGN-003", f"落款字体为“{font}”，应为仿宋_GB2312。", location)
            if abs(size - BODY_PT) > 0.5:
                add("P2", "GW-SIGN-004", f"落款字号 {size}pt，应为三号（16pt）。", location)
        else:
            if i == 1 and recipient_idx == 2 and text.endswith(("：", ":")):
                pass
            elif "仿宋" not in font:
                add("P1", "GW-BODY-003", f"正文字体为“{font}”，应为仿宋_GB2312。", location)
            if abs(size - BODY_PT) > 0.5:
                add("P0", "GW-BODY-002", f"正文字号 {size}pt，应为三号（16pt）。", location)
            if "仿宋" not in _ascii_font_name(run):
                add("P2", "GW-BODY-006", f"数字/英文西文字体为“{_ascii_font_name(run)}”，应为仿宋_GB2312。", location)
            if abs(_first_line_chars(p) - FIRST_INDENT_CHARS) > 0.1:
                add("P2", "GW-BODY-004", "正文首行缩进不是2字符。", location)

    # 落款对齐
    if date_idx is not None:
        date_p = nonempty[date_idx]
        issuer_p = None
        for p in reversed(nonempty[:date_idx]):
            if _has_right_tab(p, right_tab):
                issuer_p = p
                break
        if issuer_p is not None:
            issuer_text = issuer_p.text.strip("\t \u3000")
            expected_center = right_tab - _text_width_pt(issuer_text) / 2
            if not _has_center_tab(date_p, expected_center):
                add("P2", "GW-SIGN-002", "成文日期未以落款首行为中心对齐。", "落款")
            for p in nonempty[nonempty.index(issuer_p) + 1 : date_idx]:
                if not _has_center_tab(p, expected_center):
                    add("P2", "GW-SIGN-005", "落款续行未以首行为中心对齐。", "落款")
        else:
            right_indent = date_p.paragraph_format.right_indent
            has_right_indent = right_indent is not None and abs(right_indent.pt - SIGNATURE_RIGHT_CHARS * BODY_PT) <= 2
            if not _has_right_tab(date_p, right_tab) and not has_right_indent:
                add("P2", "GW-SIGN-001", "落款首行应右空4字符。", "落款")

    # 日期
    tail = [p.text.strip() for p in nonempty[-4:]]
    if strict_date and not any(DATE_RE.search(t) for t in tail):
        add("P1", "GW-DATE-001", "文末未识别到成文日期。", "落款")

    # 页码
    footer_specs = (
        ("奇数页", section.footer, WD_ALIGN_PARAGRAPH.RIGHT),
        ("偶数页", section.even_page_footer, WD_ALIGN_PARAGRAPH.LEFT),
    )
    for label, footer, expected_align in footer_specs:
        page_paragraphs = [p for p in footer.paragraphs if "PAGE" in p._p.xml]
        if not page_paragraphs:
            add("P1", "GW-PAGE-003", f"{label}页脚未检测到 PAGE 页码域。", "页码")
            continue
        for p in page_paragraphs:
            if p.alignment != expected_align:
                add("P1", "GW-PAGE-005", f"{label}页码未{'右' if expected_align == WD_ALIGN_PARAGRAPH.RIGHT else '左'}对齐。", "页码")
            run = _first_run(p)
            if run is not None:
                if abs(_font_size(run) - PAGE_PT) > 0.5:
                    add("P2", "GW-PAGE-006", f"{label}页码字号 {_font_size(run)}pt，应为四号（14pt）。", "页码")
                if "仿宋" not in _font_name(run):
                    add("P2", "GW-PAGE-007", f"{label}页码字体为“{_font_name(run)}”，应为仿宋_GB2312。", "页码")
            visible = p.text.replace("\t", "").strip()
            if not (visible.startswith("-") and visible.endswith("-")):
                add("P2", "GW-PAGE-008", f"{label}页码格式应形如“- 1 -”。", "页码")
            check_spacing(p, f"{label}页码", "GW-PAGE")

    return {"ok": True, "issues": issues}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: render_docx.py render|check|probe"}, ensure_ascii=False))
        return 1
    mode = sys.argv[1]
    if mode == "probe":
        import docx

        print(
            json.dumps(
                {"ok": True, "python": sys.version.split()[0], "python-docx": getattr(docx, "__version__", "unknown")},
                ensure_ascii=False,
            )
        )
        return 0
    if mode == "render":
        payload = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
        print(json.dumps(render(payload), ensure_ascii=False))
        return 0
    if mode == "check":
        print(json.dumps(check(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else ""), ensure_ascii=False))
        return 0
    print(json.dumps({"ok": False, "error": f"unknown mode: {mode}"}, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
