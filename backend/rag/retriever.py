
import re
from typing import Any

import faiss
import numpy as np


class FaissRetriever:
    def __init__(self, model=None):
        from sentence_transformers import SentenceTransformer

        self.model = model or SentenceTransformer(
            "all-MiniLM-L6-v2"
        )

        if hasattr(self.model, "get_sentence_embedding_dimension"):
            self.dim = self.model.get_sentence_embedding_dimension()
        else:
            self.dim = 384

        self.index = faiss.IndexFlatIP(self.dim)
        self.docs: list[dict[str, Any]] = []

    def add_documents(self, docs: list[dict[str, Any]]) -> None:
        if not docs:
            raise ValueError("No documents provided.")

        valid_docs = [
            doc for doc in docs
            if isinstance(doc.get("text"), str)
            and doc["text"].strip()
        ]

        if not valid_docs:
            raise ValueError("No valid document text provided.")

        texts = [doc["text"] for doc in valid_docs]

        try:
            import torch
            with torch.no_grad():
                embeddings = self.model.encode(
                    texts,
                    convert_to_numpy=True,
                    show_progress_bar=False,
                )
        except Exception:
            embeddings = self.model.encode(
                texts,
                convert_to_numpy=True,
                show_progress_bar=False,
            )

        embeddings = np.asarray(
            embeddings,
            dtype="float32",
        )

        if embeddings.ndim != 2 or embeddings.shape[1] != self.dim:
            raise ValueError("Embedding dimensions do not match.")

        if not np.isfinite(embeddings).all():
            raise ValueError("Embeddings contain invalid values.")

        faiss.normalize_L2(embeddings)

        self.index = faiss.IndexFlatIP(self.dim)
        self.index.add(embeddings)
        self.docs = valid_docs

    def retrieve(
        self,
        query: str,
        k: int = 5,
    ) -> list[tuple[float, dict[str, Any]]]:
        if not isinstance(query, str) or not query.strip():
            return []

        if k <= 0 or not self.docs:
            return []

        try:
            import torch
            with torch.no_grad():
                query_embedding = self.model.encode(
                    [query.strip()],
                    convert_to_numpy=True,
                    show_progress_bar=False,
                )
        except Exception:
            query_embedding = self.model.encode(
                [query.strip()],
                convert_to_numpy=True,
                show_progress_bar=False,
            )

        query_embedding = np.asarray(
            query_embedding,
            dtype="float32",
        )

        if (
            query_embedding.ndim != 2
            or query_embedding.shape[1] != self.dim
        ):
            raise ValueError("Query embedding dimensions do not match.")

        if not np.isfinite(query_embedding).all():
            raise ValueError("Query embedding contains invalid values.")

        faiss.normalize_L2(query_embedding)

        candidate_count = min(
            len(self.docs),
            max(k * 4, k),
        )

        scores, indices = self.index.search(
            query_embedding,
            candidate_count,
        )

        query_words = set(
            re.findall(r"[a-z0-9]+", query.casefold())
        )

        results = []

        for idx, score in zip(indices[0], scores[0]):
            if idx < 0 or idx >= len(self.docs):
                continue

            doc = self.docs[idx]
            text = doc["text"]

            doc_words = set(
                re.findall(r"[a-z0-9]+", text.casefold())
            )

            meaningful_words = {
                word for word in query_words
                if len(word) > 2
            }

            keyword_score = 0.0

            if meaningful_words:
                keyword_score = (
                    len(meaningful_words & doc_words)
                    / len(meaningful_words)
                )

            semantic_score = float(score)

            final_score = (
                semantic_score
                + 0.05 * keyword_score
            )

            results.append((final_score, doc))

        results.sort(
            key=lambda item: item[0],
            reverse=True,
        )

        return results[:k]
