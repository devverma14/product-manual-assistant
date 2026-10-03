import re
from typing import Tuple

try:
    import tiktoken

    _ENCODER = tiktoken.get_encoding("cl100k_base")

    def _count_tokens(text: str) -> int:
        return len(_ENCODER.encode(text))

except Exception:

    def _count_tokens(text: str) -> int:
        return len(re.findall(r"\S+", text))


_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "to", "of", "in",
    "on", "for", "with", "at", "by", "from", "is", "are",
    "was", "were", "be", "been", "being", "do", "does",
    "did", "how", "what", "when", "where", "why", "which",
    "who", "whom", "this", "that", "these", "those", "it",
    "its", "as", "if", "then", "than", "can", "could",
    "would", "should", "will", "may", "might", "must",
    "i", "you", "we", "they", "he", "she", "them", "your",
    "our", "their", "my", "me", "not", "about", "into",
    "also", "have", "has", "had", "using", "use",
}


def _keywords(text: str) -> set[str]:
    """Extract meaningful words for lexical relevance matching."""
    words = re.findall(r"\b[a-zA-Z0-9]+\b", text.lower())

    return {
        word
        for word in words
        if word not in _STOPWORDS and len(word) > 1
    }


def compress_context(
    text: str,
    target_ratio: float = 0.75,
    question: str = "",
) -> Tuple[str, dict]:
    """
    Prioritize question-relevant sentences while preserving their order.
    Return the compressed text and measured token statistics.
    """
    tokens_before = _count_tokens(text)

    if not text.strip() or not question.strip():
        return text, {
            "tokens_before": tokens_before,
            "tokens_after": tokens_before,
            "percent_savings": 0.0,
        }

    if not 0 < target_ratio <= 1:
        raise ValueError("target_ratio must be greater than 0 and at most 1.")

    sentences = [
        sentence.strip()
        for sentence in re.split(r"(?<=[.!?])\s+", text.strip())
        if sentence.strip()
    ]

    if len(sentences) <= 1:
        return text, {
            "tokens_before": tokens_before,
            "tokens_after": tokens_before,
            "percent_savings": 0.0,
        }

    question_words = _keywords(question)

    if not question_words:
        return text, {
            "tokens_before": tokens_before,
            "tokens_after": tokens_before,
            "percent_savings": 0.0,
        }

    scored_sentences = []

    for index, sentence in enumerate(sentences):
        sentence_words = _keywords(sentence)
        overlap = question_words.intersection(sentence_words)

        scored_sentences.append({
            "index": index,
            "text": sentence,
            "score": len(overlap),
            "tokens": _count_tokens(sentence),
        })

    # Avoid removing context when no lexical relevance is found.
    if not any(item["score"] > 0 for item in scored_sentences):
        return text, {
            "tokens_before": tokens_before,
            "tokens_after": tokens_before,
            "percent_savings": 0.0,
        }

    token_budget = max(
        1,
        int(tokens_before * target_ratio),
    )

    ranked = sorted(
        scored_sentences,
        key=lambda item: (
            item["score"],
            -item["index"],
        ),
        reverse=True,
    )

    selected = []
    tokens_selected = 0

    for item in ranked:
        if item["score"] == 0:
            continue

        if tokens_selected + item["tokens"] <= token_budget:
            selected.append(item)
            tokens_selected += item["tokens"]

    # Keep the most relevant sentence if the budget is too small.
    if not selected:
        selected = [ranked[0]]

    # Restore the original order for readable context.
    selected.sort(key=lambda item: item["index"])

    compressed = " ".join(
        item["text"] for item in selected
    )

    tokens_after = _count_tokens(compressed)

    percent_savings = (
        100 * (1 - tokens_after / tokens_before)
        if tokens_before
        else 0.0
    )

    return compressed, {
        "tokens_before": tokens_before,
        "tokens_after": tokens_after,
        "percent_savings": round(percent_savings, 2),
    }