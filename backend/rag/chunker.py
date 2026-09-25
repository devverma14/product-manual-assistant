def chunk_text(text, chunk_size=900, overlap=120):
    """
    Splits manual text into overlapping chunks.
    Skips useless Table of Contents chunks.
    """

    words = text.split()
    chunks = []

    start = 0
    chunk_id = 0

    while start < len(words):
        end = start + chunk_size
        chunk_words = words[start:end]

        chunk_text_data = " ".join(chunk_words).strip()

        # ✅ Skip empty chunks
        if not chunk_text_data:
            start += chunk_size - overlap
            continue

        # ✅ Skip Table of Contents
        if "table of contents" in chunk_text_data.lower():
            start += chunk_size - overlap
            continue

        chunks.append({
            "id": f"chunk_{chunk_id}",
            "text": chunk_text_data,
            "tokens": len(chunk_words)
        })

        chunk_id += 1
        start += chunk_size - overlap

    return chunks
