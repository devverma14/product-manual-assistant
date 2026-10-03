from __future__ import annotations

import json
import logging
import os
import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from backend.api.auth import get_current_user_optional
from backend.database import (
    db_create_collection,
    db_create_conversation,
    db_delete_conversation,
    db_delete_document,
    db_get_analytics,
    db_get_chunks_for_document,
    db_get_conversation,
    db_get_document,
    db_insert_document,
    db_list_collections,
    db_list_conversations,
    db_list_documents,
    db_save_chat_messages,
    delete_faiss_index_from_disk,
    load_faiss_index_from_disk,
    save_faiss_index_to_disk,
)
from backend.rag.chunker import chunk_text
from backend.rag.generator import generate_answer
from backend.rag.pdf_loader import load_pdf_pages_bytes
from backend.rag.retriever import FaissRetriever
from backend.scaledown.compressor import compress_context

# Load environment variables from root .env
load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Application configuration
APP_NAME = "Product Manual Assistant"
APP_VERSION = "1.0.0"

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
DEFAULT_EMBEDDING_MODEL = "all-MiniLM-L6-v2"
DEFAULT_TOP_K = 5
MIN_RETRIEVAL_SCORE = 0.20
COMPRESSION_TARGET_RATIO = 0.90


def filter_relevant_sources(raw_sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Filter retrieved candidate sources to return only genuinely relevant/supporting sources for display.
    Retrieved candidates (up to 5) are used internally for answer generation.
    Before returning/displaying sources, weak or clearly irrelevant source chunks are filtered out.
    """
    if not raw_sources:
        return []

    top_score = max(float(s.get("score", 0)) for s in raw_sources)
    rel_threshold = max(MIN_RETRIEVAL_SCORE, top_score * 0.75)
    return [s for s in raw_sources if float(s.get("score", 0)) >= rel_threshold]


def extract_cited_pages(answer_text: str) -> list[int]:
    """Extract page numbers explicitly cited in the generated answer text."""
    if not answer_text:
        return []

    matches = re.findall(r"(?:\[|\b)Pages?\s*([0-9,\s&and]+)(?:\]|\b)", answer_text, flags=re.IGNORECASE)
    pages: set[int] = set()
    for match in matches:
        nums = re.findall(r"\b\d+\b", match)
        for num in nums:
            pages.add(int(num))

    direct_nums = re.findall(r"\bPage\s*(\d+)\b", answer_text, flags=re.IGNORECASE)
    for num in direct_nums:
        pages.add(int(num))

    return sorted(pages)


def filter_answer_grounded_sources(raw_sources: list[dict[str, Any]], answer_text: str) -> list[dict[str, Any]]:
    """
    Build final user-facing sources array from retrieved candidate chunks whose page numbers
    were actually cited in the generated answer.
    Deduplicates by page number and falls back safely to filter_relevant_sources if no valid citations exist.
    """
    if not raw_sources:
        return []

    cited_pages = extract_cited_pages(answer_text)

    if cited_pages:
        cited_set = set(cited_pages)
        matching_sources = [s for s in raw_sources if s.get("page") in cited_set]

        if matching_sources:
            page_best_map: dict[int, dict[str, Any]] = {}
            for s in matching_sources:
                pg = s["page"]
                if pg not in page_best_map or float(s.get("score", 0)) > float(page_best_map[pg].get("score", 0)):
                    page_best_map[pg] = s

            final_sources = []
            seen_pages = set()
            for s in raw_sources:
                pg = s.get("page")
                if pg in page_best_map and pg not in seen_pages:
                    final_sources.append(page_best_map[pg])
                    seen_pages.add(pg)

            return final_sources

    return filter_relevant_sources(raw_sources)



def _get_frontend_origins() -> list[str]:
    origins = os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    return [origin.strip().rstrip("/") for origin in origins.split(",") if origin.strip()]


app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Multi-document Product Manual Assistant with auth, persistent history, vector search & Supabase storage.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_frontend_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Cache for active in-memory FAISS retrievers: document_id -> FaissRetriever
_retriever_cache: dict[str, FaissRetriever] = {}


@lru_cache(maxsize=1)
def _embedding_model():
    from sentence_transformers import SentenceTransformer

    model_name = os.getenv("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL).strip()
    if not model_name:
        model_name = DEFAULT_EMBEDDING_MODEL
    logger.info("Loading embedding model: %s", model_name)
    return SentenceTransformer(model_name)


class AskRequest(BaseModel):
    question: str = Field(
        min_length=3,
        max_length=1000,
        description="Question about the uploaded product manual.",
    )
    top_k: int = Field(
        default=DEFAULT_TOP_K,
        ge=1,
        le=8,
        description="Maximum number of relevant chunks to retrieve.",
    )


class CreateConversationRequest(BaseModel):
    document_id: str | None = None
    title: str = "New Conversation"


class CreateCollectionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""


def _get_safe_filename(filename: str | None) -> str:
    if not filename:
        return "Manual.pdf"
    safe_name = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    return safe_name or "Manual.pdf"


def _build_page_chunks(pdf_bytes: bytes) -> tuple[list[dict[str, Any]], int, str]:
    pages = load_pdf_pages_bytes(pdf_bytes)
    chunks: list[dict[str, Any]] = []
    all_text: list[str] = []

    for page in pages:
        page_number = page["page"]
        page_text = page["text"].strip()
        if not page_text:
            continue
        all_text.append(page_text)
        page_chunks = chunk_text(page_text)
        for item in page_chunks:
            item["page"] = page_number
            chunks.append(item)

    full_text = "\n\n".join(all_text)
    return chunks, len(pages), full_text


def _create_retriever(chunks: list[dict[str, Any]]) -> FaissRetriever:
    retriever = FaissRetriever(model=_embedding_model())
    retriever.add_documents(chunks)
    return retriever


def _get_or_load_retriever(document_id: str) -> FaissRetriever:
    if document_id in _retriever_cache:
        return _retriever_cache[document_id]

    # Load FAISS index from disk if present
    retriever = load_faiss_index_from_disk(document_id, _embedding_model())
    if retriever:
        _retriever_cache[document_id] = retriever
        return retriever

    # Rebuild from DB chunks if disk index missing
    chunks = db_get_chunks_for_document(document_id)
    if not chunks:
        raise HTTPException(
            status_code=404,
            detail="Document index not found and no searchable chunks exist.",
        )

    retriever = _create_retriever(chunks)
    save_faiss_index_to_disk(document_id, retriever)
    _retriever_cache[document_id] = retriever
    return retriever


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": APP_NAME}


# ====================================================================
# Document Library Endpoints (Multi-Document & Ownership Enforcement)
# ====================================================================

@app.get("/api/manuals")
def list_manuals(user: dict[str, Any] = Depends(get_current_user_optional)) -> list[dict[str, Any]]:
    return db_list_documents(user["id"])


@app.post("/api/manuals")
async def upload_manual(
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    user_id = user["id"]
    filename = _get_safe_filename(file.filename)

    if Path(filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Please upload a PDF manual.")

    try:
        payload = await file.read(MAX_UPLOAD_BYTES + 1)
    except Exception as exc:
        logger.exception("Failed to read uploaded file.")
        raise HTTPException(status_code=400, detail="The uploaded file could not be read.") from exc
    finally:
        await file.close()

    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded PDF is empty.")
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The maximum PDF upload size is 20 MB.")
    if not payload.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid PDF.")

    chunks, page_count, full_text = await run_in_threadpool(_build_page_chunks, payload)
    if not full_text.strip() or not chunks:
        raise HTTPException(status_code=422, detail="No readable text was found in this PDF.")

    retriever = await run_in_threadpool(_create_retriever, chunks)

    document_id = str(uuid.uuid4())
    words_count = len(full_text.split())

    db_insert_document(
        doc_id=document_id,
        user_id=user_id,
        filename=filename,
        file_size=len(payload),
        pages=page_count,
        words=words_count,
        chunks=chunks,
        pdf_bytes=payload,
    )

    save_faiss_index_to_disk(document_id, retriever)
    _retriever_cache[document_id] = retriever

    logger.info("Document indexed: %s (%d pages, %d chunks) for user %s", filename, page_count, len(chunks), user_id)

    return {
        "id": document_id,
        "name": filename,
        "pages": page_count,
        "words": words_count,
        "chunks": len(chunks),
        "status": "indexed",
    }


@app.get("/api/manuals/{manual_id}")
def get_manual(
    manual_id: str,
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    doc = db_get_document(manual_id, user_id=user["id"])
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


@app.delete("/api/manuals/{manual_id}")
def delete_manual(
    manual_id: str,
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, str]:
    user_id = user["id"]
    doc = db_get_document(manual_id, user_id=user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    _retriever_cache.pop(manual_id, None)
    db_delete_document(manual_id, user_id=user_id)
    return {"status": "deleted", "message": "Manual and its search index deleted successfully."}


# ====================================================================
# Conversation & Chat Persistence Endpoints
# ====================================================================

@app.get("/api/conversations")
def list_conversations(user: dict[str, Any] = Depends(get_current_user_optional)) -> list[dict[str, Any]]:
    return db_list_conversations(user["id"])


@app.post("/api/conversations")
def create_conversation(
    req: CreateConversationRequest,
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    user_id = user["id"]
    if req.document_id:
        doc = db_get_document(req.document_id, user_id=user_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Referenced document not found.")

    conv_id = str(uuid.uuid4())
    return db_create_conversation(conv_id, user_id, req.document_id, req.title)


@app.get("/api/conversations/{conversation_id}")
def get_conversation(
    conversation_id: str,
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    conv = db_get_conversation(conversation_id, user_id=user["id"])
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conv


@app.post("/api/conversations/{conversation_id}/questions")
def ask_in_conversation(
    conversation_id: str,
    request: AskRequest,
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    user_id = user["id"]
    conv = db_get_conversation(conversation_id, user_id=user_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    document_id = conv.get("document_id")
    if not document_id:
        raise HTTPException(status_code=400, detail="This conversation is not linked to a document.")

    # Enforce ownership on referenced document
    doc = db_get_document(document_id, user_id=user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Linked document not found.")

    question = request.question.strip()
    retriever = _get_or_load_retriever(document_id)

    try:
        results = retriever.retrieve(question, k=request.top_k)
    except Exception as exc:
        logger.exception("Retrieval failed.")
        raise HTTPException(status_code=500, detail="Manual search failed.") from exc

    if not results or float(results[0][0]) < MIN_RETRIEVAL_SCORE:
        answer_data = {
            "answer": "I couldn't find a relevant section in this manual. Try using exact terms from the manual.",
            "mode": "no_match",
            "sources": [],
            "compression": None,
        }
    else:
        sources = [
            {"page": doc_item.get("page"), "text": doc_item["text"], "score": round(float(score), 3)}
            for score, doc_item in results
        ]

        compressed_sources = []
        totals = {"tokens_before": 0, "tokens_after": 0}
        for s in sources:
            comp_text, metrics = compress_context(s["text"], target_ratio=COMPRESSION_TARGET_RATIO, question=question)
            compressed_sources.append({**s, "text": comp_text})
            totals["tokens_before"] += metrics["tokens_before"]
            totals["tokens_after"] += metrics["tokens_after"]

        totals["percent_savings"] = round(100 * (1 - totals["tokens_after"] / max(totals["tokens_before"], 1)), 2)

        generated = generate_answer(question, compressed_sources)
        filtered_sources = filter_answer_grounded_sources(sources, generated.get("answer", ""))
        answer_data = {**generated, "sources": filtered_sources, "compression": totals}

    new_title = None
    if conv.get("title") == "New Conversation":
        new_title = question[:40] + ("..." if len(question) > 40 else "")

    db_save_chat_messages(
        conversation_id=conversation_id,
        user_id=user_id,
        question=question,
        answer_data=answer_data,
        new_title=new_title,
    )

    return answer_data


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, str]:
    user_id = user["id"]
    conv = db_get_conversation(conversation_id, user_id=user_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    db_delete_conversation(conversation_id, user_id=user_id)
    return {"status": "deleted", "message": "Conversation deleted successfully."}


# Endpoint for single manual direct query with ownership check
@app.post("/api/manuals/{manual_id}/questions")
def ask_direct_question(
    manual_id: str,
    request: AskRequest,
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    user_id = user["id"]
    doc = db_get_document(manual_id, user_id=user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    question = request.question.strip()
    retriever = _get_or_load_retriever(manual_id)
    results = retriever.retrieve(question, k=request.top_k)

    if not results or float(results[0][0]) < MIN_RETRIEVAL_SCORE:
        return {
            "answer": "I couldn't find a relevant section in this manual. Try using exact terms from the manual.",
            "mode": "no_match",
            "sources": [],
            "compression": None,
        }

    sources = [
        {"page": doc_item.get("page"), "text": doc_item["text"], "score": round(float(score), 3)}
        for score, doc_item in results
    ]

    compressed_sources = []
    totals = {"tokens_before": 0, "tokens_after": 0}
    for s in sources:
        comp_text, metrics = compress_context(s["text"], target_ratio=COMPRESSION_TARGET_RATIO, question=question)
        compressed_sources.append({**s, "text": comp_text})
        totals["tokens_before"] += metrics["tokens_before"]
        totals["tokens_after"] += metrics["tokens_after"]

    totals["percent_savings"] = round(100 * (1 - totals["tokens_after"] / max(totals["tokens_before"], 1)), 2)

    generated = generate_answer(question, compressed_sources)
    filtered_sources = filter_answer_grounded_sources(sources, generated.get("answer", ""))
    return {**generated, "sources": filtered_sources, "compression": totals}


# ====================================================================
# Analytics & Collections Endpoints
# ====================================================================

@app.get("/api/analytics")
def get_analytics(user: dict[str, Any] = Depends(get_current_user_optional)) -> dict[str, Any]:
    return db_get_analytics(user["id"])


@app.get("/api/collections")
def list_collections(user: dict[str, Any] = Depends(get_current_user_optional)) -> list[dict[str, Any]]:
    return db_list_collections(user["id"])


@app.post("/api/collections")
def create_collection(
    req: CreateCollectionRequest,
    user: dict[str, Any] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    col_id = str(uuid.uuid4())
    return db_create_collection(col_id, user["id"], req.name, req.description)
