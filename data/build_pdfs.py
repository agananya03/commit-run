#!/usr/bin/env python3
"""
build_pdfs.py
Renders proposal.md in each /data/scenarios/{proposal_id}/ into proposal.pdf
using reportlab with title page, styled tables, page numbers, and "SYNTHETIC DATA" footer.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
    HRFlowable,
)
from reportlab.pdfgen import canvas


class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas to calculate total page count and draw running header/footer
    with page numbers and 'SYNTHETIC DATA' footer on all pages.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, total_pages: int):
        self.saveState()
        page_num = self._pageNumber
        width, height = letter

        # Running Header (pages 2+)
        if page_num > 1:
            self.setFont("Helvetica-Bold", 8)
            self.setFillColor(colors.HexColor("#64748b"))
            self.drawString(54, height - 36, "MERIDIAN DAO  |  GOVERNANCE PROPOSAL SPECIFICATION")
            self.setStrokeColor(colors.HexColor("#e2e8f0"))
            self.setLineWidth(0.75)
            self.line(54, height - 42, width - 54, height - 42)

        # Running Footer (all pages)
        self.setStrokeColor(colors.HexColor("#e2e8f0"))
        self.setLineWidth(0.75)
        self.line(54, 46, width - 54, 46)

        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor("#dc2626"))
        self.drawString(54, 32, "SYNTHETIC DATA - MERIDIAN DAO SIMULATION ONLY")

        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748b"))
        page_str = f"Page {page_num} of {total_pages}"
        self.drawRightString(width - 54, 32, page_str)

        self.restoreState()


def parse_markdown(md_text: str):
    """
    Simple markdown parser returning document structure:
    - title
    - metadata dict
    - list of blocks: ('heading', level, text), ('paragraph', text), ('list', items), ('table', headers, rows)
    """
    lines = md_text.splitlines()
    title = ""
    metadata = {}
    blocks = []

    i = 0
    n = len(lines)

    # First pass: extract title and metadata
    while i < n:
        line = lines[i].strip()
        if not line or line.startswith("<!--"):
            i += 1
            continue

        if line.startswith("# ") and not title:
            title = line[2:].strip()
            i += 1
            continue

        # Check metadata lines like **Key**: Value
        meta_match = re.match(r"^\*\*([^:]+)\*\*:\s*(.+)$", line)
        if meta_match and not blocks:
            k, v = meta_match.group(1).strip(), meta_match.group(2).strip()
            metadata[k] = v
            i += 1
            continue

        if line == "---":
            i += 1
            break

        i += 1

    # Second pass: parse body blocks
    current_table = []
    current_list = []

    def flush_table():
        nonlocal current_table
        if current_table:
            # parse table rows
            rows = []
            for tline in current_table:
                # remove leading/trailing pipe and split
                raw_cells = [c.strip() for c in tline.strip("|").split("|")]
                # Skip divider row | :--- | :--- |
                if all(re.match(r"^:?-+:?$", c) for c in raw_cells):
                    continue
                rows.append(raw_cells)
            if rows:
                headers = rows[0]
                data_rows = rows[1:] if len(rows) > 1 else []
                blocks.append(("table", headers, data_rows))
            current_table = []

    def flush_list():
        nonlocal current_list
        if current_list:
            blocks.append(("list", list(current_list)))
            current_list = []

    while i < n:
        line = lines[i].rstrip()
        trimmed = line.strip()

        if not trimmed or trimmed.startswith("<!--"):
            flush_table()
            flush_list()
            i += 1
            continue

        # Table row
        if trimmed.startswith("|") and trimmed.endswith("|"):
            flush_list()
            current_table.append(trimmed)
            i += 1
            continue
        else:
            flush_table()

        # Headings
        if trimmed.startswith("## "):
            flush_list()
            blocks.append(("heading", 2, trimmed[3:].strip()))
            i += 1
            continue
        elif trimmed.startswith("### "):
            flush_list()
            blocks.append(("heading", 3, trimmed[4:].strip()))
            i += 1
            continue
        elif trimmed == "---":
            flush_list()
            blocks.append(("divider", None))
            i += 1
            continue

        # List items
        list_match = re.match(r"^[-*]\s+(.+)$", trimmed) or re.match(r"^\d+\.\s+(.+)$", trimmed)
        if list_match:
            current_list.append(list_match.group(1))
            i += 1
            continue
        else:
            flush_list()

        # Normal paragraph (accumulate multi-line paragraphs)
        para_lines = [trimmed]
        while i + 1 < n and lines[i + 1].strip() and not lines[i + 1].strip().startswith(("#", "|", "-", "*", "---")) and not re.match(r"^\d+\.\s+", lines[i + 1].strip()):
            i += 1
            para_lines.append(lines[i].strip())
        blocks.append(("paragraph", " ".join(para_lines)))
        i += 1

    flush_table()
    flush_list()

    return title, metadata, blocks


def build_pdf_for_proposal(proposal_md_path: Path, output_pdf_path: Path):
    with open(proposal_md_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    title, metadata, blocks = parse_markdown(md_text)

    # Page setup
    doc = SimpleDocTemplate(
        str(output_pdf_path),
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54,
    )

    styles = getSampleStyleSheet()

    # Custom styles
    title_style = ParagraphStyle(
        "CoverTitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=24,
        leading=28,
        textColor=colors.HexColor("#0f172a"),
        spaceAfter=14,
    )

    subtitle_style = ParagraphStyle(
        "CoverSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica-Bold",
        fontSize=14,
        leading=18,
        textColor=colors.HexColor("#2563eb"),
        spaceAfter=20,
    )

    h2_style = ParagraphStyle(
        "SectionH2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        textColor=colors.HexColor("#0f172a"),
        spaceBefore=14,
        spaceAfter=8,
        keepWithNext=True,
    )

    h3_style = ParagraphStyle(
        "SectionH3",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=10,
        leading=13,
        textColor=colors.HexColor("#1e293b"),
        spaceBefore=10,
        spaceAfter=4,
        keepWithNext=True,
    )

    body_style = ParagraphStyle(
        "BodyDark",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=9.5,
        leading=13.5,
        textColor=colors.HexColor("#334155"),
        spaceAfter=8,
    )

    list_style = ParagraphStyle(
        "ListDark",
        parent=body_style,
        leftIndent=15,
        firstLineIndent=-10,
        spaceAfter=4,
    )

    meta_label_style = ParagraphStyle(
        "MetaLabel",
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#475569"),
    )

    meta_val_style = ParagraphStyle(
        "MetaVal",
        fontName="Helvetica",
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#0f172a"),
    )

    story = []

    # --- TITLE PAGE ---
    story.append(Spacer(1, 0.4 * inch))
    # Badge
    story.append(
        Paragraph(
            "<font color='#0284c7'><b>MERIDIAN DAO FORMAL GOVERNANCE</b></font>",
            ParagraphStyle("Pill", fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor("#0284c7")),
        )
    )
    story.append(Spacer(1, 10))
    story.append(Paragraph(title or "Meridian Improvement Proposal", title_style))
    if "Proposal Title" in metadata:
        story.append(Paragraph(metadata["Proposal Title"], subtitle_style))
    elif "Title" in metadata:
        story.append(Paragraph(metadata["Title"], subtitle_style))

    story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#2563eb"), spaceAfter=18))

    # Metadata table
    if metadata:
        meta_table_data = []
        for k, v in metadata.items():
            meta_table_data.append([
                Paragraph(f"{k}", meta_label_style),
                Paragraph(f"{v}", meta_val_style),
            ])

        meta_t = Table(meta_table_data, colWidths=[120, 384])
        meta_t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f8fafc")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#edf2f7")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(meta_t)
        story.append(Spacer(1, 18))

    # Synthetic disclaimer callout on title page
    disclaimer_data = [[
        Paragraph(
            "<b>NOTICE:</b> All parameters, figures, organizations, and entities in this document are "
            "synthetic fixtures constructed exclusively for Meridian DAO security evaluation. "
            "Not for public circulation.",
            ParagraphStyle("Disclaimer", fontName="Helvetica", fontSize=8.5, leading=11, textColor=colors.HexColor("#b91c1c")),
        )
    ]]
    disclaimer_table = Table(disclaimer_data, colWidths=[504])
    disclaimer_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fef2f2")),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#f87171")),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(disclaimer_table)

    # Page Break after title page to ensure structured, multi-page layout
    story.append(PageBreak())

    # --- BODY CONTENT ---
    printable_width = 504  # 612 - 108

    for block in blocks:
        btype = block[0]

        if btype == "heading":
            level = block[1]
            htext = block[2]
            # Replace markdown bold inside headings
            clean_htext = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", htext)
            if level == 2:
                story.append(Paragraph(clean_htext, h2_style))
                story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cbd5e1"), spaceAfter=8))
            else:
                story.append(Paragraph(clean_htext, h3_style))

        elif btype == "paragraph":
            ptext = block[1]
            # Convert markdown formatting
            ptext = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", ptext)
            ptext = re.sub(r"\*(.+?)\*", r"<i>\1</i>", ptext)
            story.append(Paragraph(ptext, body_style))

        elif btype == "list":
            items = block[1]
            for item in items:
                formatted_item = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", item)
                story.append(Paragraph(f"• {formatted_item}", list_style))
            story.append(Spacer(1, 6))

        elif btype == "divider":
            story.append(Spacer(1, 4))
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e2e8f0"), spaceAfter=8))

        elif btype == "table":
            headers = block[1]
            data_rows = block[2]

            num_cols = len(headers)
            if num_cols == 3:
                col_widths = [140, 264, 100]
            elif num_cols == 2:
                col_widths = [160, 344]
            else:
                col_widths = [printable_width / num_cols] * num_cols

            th_style = ParagraphStyle(
                "TH",
                fontName="Helvetica-Bold",
                fontSize=8.5,
                leading=11,
                textColor=colors.HexColor("#ffffff"),
            )
            td_style = ParagraphStyle(
                "TD",
                fontName="Helvetica",
                fontSize=8.5,
                leading=11,
                textColor=colors.HexColor("#1e293b"),
            )

            table_matrix = []
            # Header row
            header_cells = [
                Paragraph(re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", h), th_style)
                for h in headers
            ]
            table_matrix.append(header_cells)

            # Data rows
            for row in data_rows:
                # pad or trim
                row_cells = []
                for c in (row + [""] * (num_cols - len(row)))[:num_cols]:
                    fmt = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", c)
                    row_cells.append(Paragraph(fmt, td_style))
                table_matrix.append(row_cells)

            report_table = Table(table_matrix, colWidths=col_widths, repeatRows=1)
            t_style = [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e293b")),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd5e1")),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
            # Alternating rows
            for r_idx in range(1, len(table_matrix)):
                bg = colors.HexColor("#f8fafc") if r_idx % 2 == 1 else colors.HexColor("#ffffff")
                t_style.append(("BACKGROUND", (0, r_idx), (-1, r_idx), bg))

            report_table.setStyle(TableStyle(t_style))
            story.append(Spacer(1, 4))
            story.append(report_table)
            story.append(Spacer(1, 10))

    # Build PDF with custom NumberedCanvas
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated: {output_pdf_path}")


def main():
    root = Path(__file__).resolve().parent
    scenarios_dir = root / "scenarios"

    targets = ["MIP-12", "MIP-17", "MIP-21"]
    if len(sys.argv) > 1:
        targets = sys.argv[1:]

    for scenario_name in targets:
        scenario_path = scenarios_dir / scenario_name
        md_file = scenario_path / "proposal.md"
        pdf_file = scenario_path / "proposal.pdf"

        if not md_file.exists():
            print(f"Warning: {md_file} not found, skipping.")
            continue

        print(f"Rendering {md_file} -> {pdf_file}...")
        build_pdf_for_proposal(md_file, pdf_file)


if __name__ == "__main__":
    main()
