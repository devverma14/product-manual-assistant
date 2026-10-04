
import re
from typing import Any

import faiss
import numpy as np


class FaissRetriever:
    def __init__(self, model=None):
        if model is not None:
            self.model = model
        else:
            try:
                from backend.api.main import _embedding_model

                self.model = _embedding_model()
            except Exception:
                from fastembed import TextEmbedding

                self.model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5", threads=1)

        if hasattr(self.model, "get_sentence_embedding_dimension"):
            self.dim = self.model.get_sentence_embedding_dimension()
        elif hasattr(self.model, "dim"):
            self.dim = self.model.dim
        else:
            self.dim = 384

        self.index = faiss.IndexFlatIP(self.dim)
        self.docs: list[dict[str, Any]] = []

    @property
    def documents(self) -> list[dict[str, Any]]:
        return self.docs

    @documents.setter
    def documents(self, value: list[dict[str, Any]]) -> None:
        self.docs = value

    @property
    def dimension(self) -> int:
        return self.dim

    @dimension.setter
    def dimension(self, value: int) -> None:
        self.dim = value

    def _encode_texts(self, texts: list[str]) -> np.ndarray:
        if hasattr(self.model, "embed"):
            raw_embeddings = list(self.model.embed(texts, batch_size=16))
            embeddings = np.array(raw_embeddings, dtype="float32")
            del raw_embeddings
            import gc

            gc.collect()
        elif hasattr(self.model, "encode"):
            embeddings = self.model.encode(
                texts,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
        else:
            raise AttributeError("Embedding model has neither 'embed' nor 'encode' method.")

        return np.asarray(embeddings, dtype="float32")


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
        embeddings = self._encode_texts(texts)

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

        query_embedding = self._encode_texts([query.strip()])

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

