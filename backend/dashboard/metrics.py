from typing import Dict

def compute_manual_metrics(text: str, page_count: int) -> Dict:
    words = len(text.split())
    return {'pages': page_count, 'words': words}
