import re
from typing import Tuple

try:
    import tiktoken
    def _count_tokens(text):
        enc = tiktoken.get_encoding('cl100k_base')
        return len(enc.encode(text))
except Exception:
    def _count_tokens(text):
        return len(re.findall(r"\S+", text))


def compress_context(text: str, target_ratio: float = 0.75) -> Tuple[str, dict]:
    """Compress large context heuristically and return (compressed_text, metrics).

    Metrics include tokens_before, tokens_after, percent_savings.
    """
    tokens_before = _count_tokens(text)

    lines = text.splitlines()
    out = []
    buffer = []

    def flush():
        nonlocal buffer
        if not buffer:
            return
        if len(buffer) <= 8:
            out.extend(buffer)
        else:
            out.append(buffer[0])
            out.append('...')
            out.append(buffer[-1])
        buffer = []

    sig_re = re.compile(r"^(Page|Section|Chapter|##|def |class )", re.IGNORECASE)
    for ln in lines:
        if ln.startswith('+') or ln.startswith('-') or ln.strip().startswith('#') or sig_re.search(ln):
            flush()
            out.append(ln)
        else:
            buffer.append(ln)
    flush()

    compressed = '\n'.join(out)
    tokens_after = _count_tokens(compressed)
    percent = 0.0
    if tokens_before:
        percent = 100.0 * (1 - tokens_after / tokens_before)

    return compressed, {'tokens_before': tokens_before, 'tokens_after': tokens_after, 'percent_savings': round(percent,2)}
