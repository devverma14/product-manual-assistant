import faiss
import numpy as np
from sentence_transformers import SentenceTransformer


class FaissRetriever:
    def __init__(self):
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

        sample = self.model.encode(["hello"])[0]
        self.dim = len(sample)

        # Cosine similarity index
        self.index = faiss.IndexFlatIP(self.dim)

        self.docs = []

    def add_documents(self, docs):

        if not docs:
            raise ValueError("❌ No documents provided!")

        texts = [d["text"] for d in docs]

        embs = self.model.encode(texts)
        embs = np.array(embs).astype("float32")

        faiss.normalize_L2(embs)

        self.index.add(embs)
        self.docs = docs

    def retrieve(self, query, k=5):

        q_emb = self.model.encode([query])
        q_emb = np.array(q_emb).astype("float32")
        faiss.normalize_L2(q_emb)

        scores, indices = self.index.search(q_emb, 10)

        query_words = query.lower().split()

        results = []
        for idx, score in zip(indices[0], scores[0]):

            if idx >= len(self.docs):
                continue

            doc = self.docs[idx]
            text = doc["text"].lower()

            # Skip TOC
            if "table of contents" in text:
                continue

            # Keyword boost
            keyword_score = sum(1 for w in query_words if w in text)

            final_score = score + (0.2 * keyword_score)

            results.append((final_score, doc))

        results = sorted(results, key=lambda x: x[0], reverse=True)

        return results[:k]
