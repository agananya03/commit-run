from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any

from app.models.contracts import Chunk, Hex, SourceType
from app.services.tokenizer import split_text_into_token_chunks


def _table_to_markdown(table: list[list[Any]]) -> str:
    if not table or not table[0]:
        return ""
    headers = [str(c or "").strip().replace("\n", " ") for c in table[0]]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in table[1:]:
        cols = [str(c or "").strip().replace("\n", " ") for c in row]
        # Pad or trim to header length
        if len(cols) < len(headers):
            cols.extend([""] * (len(headers) - len(cols)))
        lines.append("| " + " | ".join(cols[: len(headers)]) + " |")
    return "\n".join(lines)


def _split_into_sections(text: str) -> list[str]:
    """
    Splits text by section headings like '1. Scope', '2. Specification', '### Summary', etc.
    """
    heading_pattern = re.compile(
        r"(?=(?:^|\n)(?:[0-9]+(?:\.[0-9]+)*\.\s+[A-Z][^\n]{2,60}|#{1,4}\s+[^\n]+))"
    )
    parts = heading_pattern.split(text)
    sections = [p.strip() for p in parts if p.strip()]
    return sections if sections else [text.strip()]


def parse_pdf(
    file_path: Path | str,
    proposal_id: str,
    start_chunk_idx: int = 0,
) -> list[Chunk]:
    import pdfplumber

    path = Path(file_path)
    filename = path.name
    chunks: list[Chunk] = []
    chunk_counter = start_chunk_idx

    with pdfplumber.open(str(path)) as pdf:
        for page_idx, page in enumerate(pdf.pages):
            page_num = page_idx + 1
            raw_text = page.extract_text() or ""

            # If text is empty, attempt pytesseract OCR if installed
            if not raw_text.strip():
                try:
                    import pytesseract
                    page_image = page.to_image(resolution=300).original
                    ocr_res = pytesseract.image_to_string(page_image)
                    if ocr_res and ocr_res.strip():
                        raw_text = ocr_res.strip()
                except Exception:
                    pass

            # Extract tables and convert to markdown rows
            table_markdowns: list[str] = []
            try:
                tables = page.extract_tables() or []
                for table in tables:
                    md_table = _table_to_markdown(table)
                    if md_table:
                        table_markdowns.append(md_table)
            except Exception:
                pass

            combined_page_text = raw_text.strip()
            if table_markdowns:
                combined_page_text += "\n\n" + "\n\n".join(table_markdowns)

            if not combined_page_text.strip():
                continue

            # Chunk per section heading else per ~350 tokens
            sections = _split_into_sections(combined_page_text)
            page_chunks_text: list[str] = []

            for sec in sections:
                sub_chunks = split_text_into_token_chunks(sec, max_tokens=350, overlap=50)
                if sub_chunks:
                    page_chunks_text.extend(sub_chunks)
                else:
                    page_chunks_text.append(sec)

            for chunk_text in page_chunks_text:
                chunk_text = chunk_text.strip()
                if not chunk_text:
                    continue
                h = hashlib.sha256(chunk_text.encode("utf-8")).hexdigest()
                source_uri = f"pdf://{proposal_id}/{filename}#page={page_num}"
                chunk = Chunk(
                    id=f"{proposal_id}:pdf:{chunk_counter}",
                    proposalId=proposal_id,
                    sourceType=SourceType.pdf,
                    sourceUri=source_uri,
                    page=float(page_num),
                    text=chunk_text,
                    sha256=Hex(f"0x{h}"),
                )
                chunks.append(chunk)
                chunk_counter += 1

    # If no text was extracted at all across all pages (empty or image-only PDF),
    # emit a clear 'no extractable text' evidence warning chunk.
    if not chunks:
        warning_text = (
            f"[Evidence Warning: no extractable text] PDF document '{filename}' contains no extractable text. "
            "File is empty or image-only."
        )
        h = hashlib.sha256(warning_text.encode("utf-8")).hexdigest()
        warning_chunk = Chunk(
            id=f"{proposal_id}:pdf:{chunk_counter}",
            proposalId=proposal_id,
            sourceType=SourceType.pdf,
            sourceUri=f"pdf://{proposal_id}/{filename}#warning=no_extractable_text",
            page=1.0,
            text=warning_text,
            sha256=Hex(f"0x{h}"),
        )
        chunks.append(warning_chunk)

    return chunks
