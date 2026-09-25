import fitz
from typing import Tuple


def load_pdf_bytes(file_bytes: bytes) -> Tuple[str, int]:
    """
    Extract text from PDF bytes.
    Returns full text + page count.
    Handles scanned PDFs safely.
    """

    doc = fitz.open(stream=file_bytes, filetype="pdf")

    texts = []
    for page in doc:
        page_text = page.get_text().strip()
        if page_text:
            texts.append(page_text)

    full_text = "\n\n".join(texts)

    # ✅ Scanned PDF check
    if len(full_text) < 50:
        return "", len(doc)

    return full_text, len(doc)
