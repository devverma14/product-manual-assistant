from typing import List, Dict
import re


def generate_answer(question: str, contexts: List[Dict], compressor_metrics=None) -> Dict:
    """
    Better FREE Generator:
    Uses top 3 chunks instead of only 1.
    Removes repeated lines.
    """

    if not contexts:
        return {"answer": "❌ No relevant info found in the manual.", "sources": []}

    # Combine top 3 contexts
    combined_text = " ".join([c["text"] for c in contexts[:3]])

    combined_text = re.sub(r"\s+", " ", combined_text).strip()

    sentences = re.split(r"(?<=[.!?])\s+", combined_text)

    # Remove duplicates
    seen = set()
    unique_sentences = []
    for s in sentences:
        s_clean = s.strip()
        if s_clean and s_clean not in seen:
            unique_sentences.append(s_clean)
            seen.add(s_clean)

    # Pick top 5 sentences
    answer_lines = unique_sentences[:5]

    answer = "✅ Answer (from Manual)\n\n"
    for i, line in enumerate(answer_lines, 1):
        answer += f"{i}. {line}\n"

    answer += "\n📌 Source: Product Manual"

    return {"answer": answer, "sources": ["Top Retrieved Chunks"]}
