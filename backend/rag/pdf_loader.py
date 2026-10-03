
import os
import re
from pathlib import Path
from typing import Any

import fitz


def _get_tessdata_path() -> str | None:
    """Determine the Tesseract tessdata directory path, preferring TESSDATA_PREFIX env var."""
    env_path = os.getenv("TESSDATA_PREFIX")
    if env_path and Path(env_path).exists():
        return env_path
    win_path = r"C:\Program Files\Tesseract-OCR\tessdata"
    if Path(win_path).exists():
        return win_path
    return None


def load_pdf_pages_bytes(file_bytes: bytes) -> list[dict[str, Any]]:
    """Extract page-wise text, using OCR for scanned pages."""

    if not file_bytes:
        raise ValueError("The uploaded PDF is empty.")

    pages = []

    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        if doc.is_encrypted:
            raise ValueError("Password-protected PDFs are not supported.")

        for page_number, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()

            if len(text) < 30:
                # Inspect page metadata: invoke OCR only if the page contains raster images
                # (e.g. scanned pages or image-heavy diagrams), avoiding unnecessary OCR
                # on blank pages or pure vector line graphics.
                images = page.get_images(full=True)
                if images:
                    try:
                        tessdata_path = _get_tessdata_path()
                        ocr_kwargs: dict[str, Any] = {
                            "language": "eng",
                            "dpi": 300,
                            "full": True,
                        }
                        if tessdata_path:
                            ocr_kwargs["tessdata"] = tessdata_path

                        text_page = page.get_textpage_ocr(**ocr_kwargs)
                        text = page.get_text(
                            "text",
                            textpage=text_page,
                        ).strip()
                    except Exception as exc:
                        raise RuntimeError(
                            f"OCR failed on PDF page {page_number}. "
                            "Check that Tesseract OCR is installed and "
                            "English language data is available."
                        ) from exc

            text = text.replace("\x00", "")
            text = re.sub(r"[ \t]+", " ", text)
            text = re.sub(r"\n{3,}", "\n\n", text)
            text = text.strip()

            pages.append(
                {
                    "page": page_number,
                    "text": text,
                }
            )

    return pages


def load_pdf_bytes(file_bytes: bytes) -> tuple[str, int]:
    """Return extracted PDF text and total page count."""

    pages = load_pdf_pages_bytes(file_bytes)

    full_text = "\n\n".join(
        page["text"]
        for page in pages
        if page["text"]
    )

    return full_text, len(pages)
