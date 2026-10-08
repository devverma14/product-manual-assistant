
import logging
import os
import re
import urllib.request
from pathlib import Path
from typing import Any

import fitz

logger = logging.getLogger(__name__)


def _get_tessdata_path() -> str | None:
    """Determine the Tesseract tessdata directory path across environments."""
    # 1. Environment variable override
    env_path = os.getenv("TESSDATA_PREFIX")
    if env_path:
        p = Path(env_path)
        if p.is_dir() and (p / "eng.traineddata").exists():
            return str(p)
        if (p / "tessdata" / "eng.traineddata").exists():
            return str(p / "tessdata")

    # 2. Local project backend data tessdata directory
    local_dir = Path(__file__).parent.parent / "data" / "tessdata"
    if (local_dir / "eng.traineddata").exists():
        return str(local_dir)

    # 3. Common Linux system paths
    linux_paths = [
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/share/tesseract-ocr/4.00/tessdata",
        "/usr/share/tesseract-ocr/tessdata",
        "/usr/share/tessdata",
        "/usr/local/share/tessdata",
    ]
    for lp in linux_paths:
        if Path(lp).exists() and (Path(lp) / "eng.traineddata").exists():
            return lp

    # 4. Common Windows system paths
    win_paths = [
        r"C:\Program Files\Tesseract-OCR\tessdata",
        r"C:\Program Files (x86)\Tesseract-OCR\tessdata",
    ]
    for wp in win_paths:
        if Path(wp).exists() and (Path(wp) / "eng.traineddata").exists():
            return wp

    # 5. Fallback auto-download of tessdata_fast eng.traineddata to local_dir
    try:
        local_dir.mkdir(parents=True, exist_ok=True)
        eng_file = local_dir / "eng.traineddata"
        if not eng_file.exists():
            url = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata"
            logger.info("Downloading Tesseract eng.traineddata to %s...", eng_file)
            urllib.request.urlretrieve(url, eng_file)
        if eng_file.exists():
            return str(local_dir)
    except Exception as exc:
        logger.warning("Could not auto-download eng.traineddata: %s", exc)

    return None


def load_pdf_pages_bytes(file_bytes: bytes) -> list[dict[str, Any]]:
    """Extract page-wise text, using OCR for scanned pages with graceful error handling."""

    if not file_bytes:
        raise ValueError("The uploaded PDF is empty.")

    pages = []

    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        if doc.is_encrypted:
            raise ValueError("Password-protected PDFs are not supported.")

        if len(doc) > 50:
            raise ValueError("PDF has too many pages. Maximum allowed is 50 pages.")

        for page_number, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()

            if len(text) < 30:
                images = page.get_images(full=True)
                if images:
                    text_page = None
                    try:
                        tessdata_path = _get_tessdata_path()
                        ocr_kwargs: dict[str, Any] = {
                            "language": "eng",
                            "dpi": 150,  # 150 DPI uses 75% less RAM than 300 DPI
                            "full": True,
                        }
                        if tessdata_path:
                            ocr_kwargs["tessdata"] = tessdata_path

                        text_page = page.get_textpage_ocr(**ocr_kwargs)
                        ocr_text = page.get_text(
                            "text",
                            textpage=text_page,
                        ).strip()
                        if ocr_text:
                            text = ocr_text
                    except Exception as exc:
                        logger.warning(
                            "OCR processing skipped on PDF page %d: %s. Using standard text fallback.",
                            page_number,
                            exc,
                        )
                    finally:
                        if text_page is not None:
                            del text_page
                        del images

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

    import gc
    gc.collect()
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

