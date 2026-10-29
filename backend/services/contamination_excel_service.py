"""Small dependency-free XLSX writer for Contamination Lab numeric exports.

The exporter intentionally uses inline strings (never Excel formulas) and numeric
cells so the generated spreadsheets remain sortable, filterable, and safe to open.
"""
from __future__ import annotations

from io import BytesIO
from math import isfinite
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT = "http://schemas.openxmlformats.org/package/2006/content-types"
ET.register_namespace("", NS)


def _tag(name: str) -> str:
    return f"{{{NS}}}{name}"


def _xml(element: ET.Element) -> bytes:
    # Emit package and workbook root namespaces as standard default xmlns,
    # not auto-generated ns0 prefixes (important for strict XLSX readers).
    if element.tag.startswith("{"):
        ET.register_namespace("", element.tag[1:].split("}", 1)[0])
    ET.register_namespace("r", REL)
    return ET.tostring(element, encoding="utf-8", xml_declaration=True)


def _column_name(index: int) -> str:
    output = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        output = chr(65 + remainder) + output
    return output


def _cell(row: ET.Element, address: str, value: object, style: int = 0) -> None:
    attrs = {"r": address}
    if style:
        attrs["s"] = str(style)
    if isinstance(value, (float, int)) and not isinstance(value, bool) and isfinite(value):
        cell = ET.SubElement(row, _tag("c"), attrs)
        ET.SubElement(cell, _tag("v")).text = str(value)
    elif value is not None:
        cell = ET.SubElement(row, _tag("c"), {**attrs, "t": "inlineStr"})
        inline = ET.SubElement(cell, _tag("is"))
        ET.SubElement(inline, _tag("t")).text = str(value)


def build_contamination_workbook(
    title: str,
    dataset: str,
    method: str,
    preprocessing: str,
    columns: list[dict[str, str]],
    rows: list[dict],
) -> bytes:
    """Return a standards-compliant single-sheet .xlsx file (Office Open XML)."""
    if not columns or not rows:
        raise ValueError("The export must contain columns and at least one row.")
    if len(columns) > 50 or len(rows) > 2000:
        raise ValueError("Too many spreadsheet rows or columns.")

    sheet = ET.Element(_tag("worksheet"))
    ET.SubElement(sheet, _tag("dimension"), {"ref": f"A1:{_column_name(len(columns))}{5 + len(rows)}"})
    views = ET.SubElement(sheet, _tag("sheetViews"))
    view = ET.SubElement(views, _tag("sheetView"), {"workbookViewId": "0"})
    ET.SubElement(view, _tag("pane"), {"ySplit": "5", "topLeftCell": "A6", "activePane": "bottomLeft", "state": "frozen"})
    ET.SubElement(sheet, _tag("sheetFormatPr"), {"defaultRowHeight": "15"})
    column_defs = ET.SubElement(sheet, _tag("cols"))
    for idx, item in enumerate(columns, 1):
        width = max(14, min(34, len(item["label"]) + 4))
        ET.SubElement(column_defs, _tag("col"), {"min": str(idx), "max": str(idx), "width": str(width), "customWidth": "1"})

    data = ET.SubElement(sheet, _tag("sheetData"))
    title_row = ET.SubElement(data, _tag("row"), {"r": "1", "ht": "30", "customHeight": "1"})
    _cell(title_row, "A1", title, 1)
    meta_row = ET.SubElement(data, _tag("row"), {"r": "2"})
    _cell(meta_row, "A2", f"Dataset: {dataset}   |   Method: {method}   |   Preprocessing: {preprocessing}", 2)
    note_row = ET.SubElement(data, _tag("row"), {"r": "3"})
    if "novelty" in title.lower():
        note = (
            "Same Multi-Feature Study definition: novelty = PA+LP-only edges / all PA+LP edges. "
            "Retention is the realized edge fraction (rounded to whole edges)."
        )
    else:
        note = "Contamination = fraction of top-ranked Isolation Forest anomalies retained; relative deviations use the Wizard's definitions."
    _cell(note_row, "A3", note, 2)
    headers = ET.SubElement(data, _tag("row"), {"r": "5", "ht": "23", "customHeight": "1"})
    for j, col in enumerate(columns, 1):
        _cell(headers, f"{_column_name(j)}5", col["label"], 3)

    for i, values in enumerate(rows, 6):
        row = ET.SubElement(data, _tag("row"), {"r": str(i)})
        for j, col in enumerate(columns, 1):
            v = values.get(col["key"])
            fmt = col.get("format", "")
            style = 5 if fmt == "integer" else 6 if fmt == "percent" else 4
            if isinstance(v, str) or v is None:
                style = 0
            _cell(row, f"{_column_name(j)}{i}", v, style)
    ET.SubElement(sheet, _tag("autoFilter"), {"ref": f"A5:{_column_name(len(columns))}{5 + len(rows)}"})
    ET.SubElement(sheet, _tag("pageMargins"), {"left":"0.7", "right":"0.7", "top":"0.75", "bottom":"0.75", "header":"0.3", "footer":"0.3"})

    # CellXfs: normal, title, metadata, column-header, decimal, integer, percentage.
    stylesheet = ET.Element(_tag("styleSheet"))
    numfmts = ET.SubElement(stylesheet, _tag("numFmts"), {"count": "1"})
    ET.SubElement(numfmts, _tag("numFmt"), {"numFmtId": "164", "formatCode": "0.0000"})
    fonts = ET.SubElement(stylesheet, _tag("fonts"), {"count": "3"})
    ET.SubElement(ET.SubElement(fonts, _tag("font")), _tag("sz"), {"val": "11"})
    title_font = ET.SubElement(fonts, _tag("font"))
    ET.SubElement(title_font, _tag("b"))
    ET.SubElement(title_font, _tag("sz"), {"val": "17"})
    ET.SubElement(title_font, _tag("color"), {"rgb": "FF103A4A"})
    header_font = ET.SubElement(fonts, _tag("font"))
    ET.SubElement(header_font, _tag("b"))
    ET.SubElement(header_font, _tag("color"), {"rgb": "FFFFFFFF"})
    fills = ET.SubElement(stylesheet, _tag("fills"), {"count": "3"})
    ET.SubElement(ET.SubElement(fills, _tag("fill")), _tag("patternFill"), {"patternType": "none"})
    ET.SubElement(ET.SubElement(fills, _tag("fill")), _tag("patternFill"), {"patternType": "gray125"})
    colored_fill = ET.SubElement(ET.SubElement(fills, _tag("fill")), _tag("patternFill"), {"patternType": "solid"})
    ET.SubElement(colored_fill, _tag("fgColor"), {"rgb": "FF0F766E"})
    ET.SubElement(colored_fill, _tag("bgColor"), {"indexed": "64"})
    borders = ET.SubElement(stylesheet, _tag("borders"), {"count": "1"})
    ET.SubElement(borders, _tag("border"))
    ET.SubElement(stylesheet, _tag("cellStyleXfs"), {"count": "1"}).append(ET.Element(_tag("xf"), {"numFmtId": "0", "fontId": "0", "fillId": "0", "borderId": "0"}))
    xfs = ET.SubElement(stylesheet, _tag("cellXfs"), {"count": "7"})
    for font_id, fill_id, fmt_id in [(0,0,0),(1,0,0),(0,0,0),(2,2,0),(0,0,164),(0,0,1),(0,0,10)]:
        ET.SubElement(xfs, _tag("xf"), {"numFmtId":str(fmt_id), "fontId":str(font_id), "fillId":str(fill_id), "borderId":"0", "xfId":"0", "applyNumberFormat":"1"})
    cell_styles = ET.SubElement(stylesheet, _tag("cellStyles"), {"count":"1"})
    ET.SubElement(cell_styles, _tag("cellStyle"), {"name":"Normal", "xfId":"0"})

    workbook = ET.Element(_tag("workbook"))
    sheets = ET.SubElement(workbook, _tag("sheets"))
    ET.SubElement(sheets, _tag("sheet"), {"name":"Results", "sheetId":"1", f"{{{REL}}}id":"rId1"})
    wb_rels = ET.Element(f"{{{PKG}}}Relationships")
    ET.SubElement(wb_rels, f"{{{PKG}}}Relationship", {"Id":"rId1", "Type": f"{REL}/worksheet", "Target":"worksheets/sheet1.xml"})
    ET.SubElement(wb_rels, f"{{{PKG}}}Relationship", {"Id":"rId2", "Type": f"{REL}/styles", "Target":"styles.xml"})
    root_rels = ET.Element(f"{{{PKG}}}Relationships")
    ET.SubElement(root_rels, f"{{{PKG}}}Relationship", {"Id":"rId1", "Type":f"{REL}/officeDocument", "Target":"xl/workbook.xml"})
    content = ET.Element(f"{{{CONTENT}}}Types")
    ET.SubElement(content, f"{{{CONTENT}}}Default", {"Extension":"rels", "ContentType":"application/vnd.openxmlformats-package.relationships+xml"})
    ET.SubElement(content, f"{{{CONTENT}}}Default", {"Extension":"xml", "ContentType":"application/xml"})
    for part, ctype in [
        ("/xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"),
        ("/xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"),
        ("/xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"),
    ]:
        ET.SubElement(content, f"{{{CONTENT}}}Override", {"PartName":part, "ContentType":ctype})
    out = BytesIO()
    with ZipFile(out, "w", ZIP_DEFLATED) as z:
        for name, payload in [
            ("[Content_Types].xml", _xml(content)),
            ("_rels/.rels", _xml(root_rels)),
            ("xl/workbook.xml", _xml(workbook)),
            ("xl/_rels/workbook.xml.rels", _xml(wb_rels)),
            ("xl/worksheets/sheet1.xml", _xml(sheet)),
            ("xl/styles.xml", _xml(stylesheet)),
        ]:
            z.writestr(name, payload)
    return out.getvalue()
