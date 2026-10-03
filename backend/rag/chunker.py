
import re


def chunk_text(text: str, chunk_size: int = 900, overlap: int = 120) -> list[dict]:
    """Split manual text into overlapping word-based chunks."""

    if chunk_size <= 0:
        raise ValueError("chunk_size must be greater than zero")

    if overlap < 0 or overlap >= chunk_size:
        raise ValueError(
            "overlap must be non-negative and smaller than chunk_size"
        )

    if not text or not text.strip():
        return []

    
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    
    toc_pattern = re.compile(
        r"^\s*(table of contents|contents)\s*$",
        re.IGNORECASE,
    )

    lines = text.splitlines()
    filtered_lines = []
    inside_toc = False

    for line in lines:
        stripped = line.strip()

        if toc_pattern.match(stripped):
            inside_toc = True
            continue

        if inside_toc:
           
            if re.match(
                r"^(chapter\s+\d+|section\s+\d+|"
                r"\d+(?:\.\d+)*\s+\S)",
                stripped,
                re.IGNORECASE,
            ):
                inside_toc = False
            else:
                continue

        filtered_lines.append(line)

    text = "\n".join(filtered_lines).strip()

    if not text:
        return []

    words = text.split()
    chunks = []
    step = chunk_size - overlap
    start = 0
    chunk_id = 0

    while start < len(words):
        end = min(start + chunk_size, len(words))
        chunk_words = words[start:end]

        chunk_text_data = " ".join(chunk_words).strip()

        if chunk_text_data:
            chunks.append(
                {
                    "id": f"chunk_{chunk_id}",
                    "text": chunk_text_data,
                    "tokens": len(chunk_words),
                }
            )
            chunk_id += 1

        if end == len(words):
            break

        start += step

    return chunks
