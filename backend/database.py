"""
Database and Index Persistence Layer for Product Manual Assistant.

Dual-mode architecture:
- Supabase PostgreSQL + Storage when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
- Local SQLite + File storage fallback when Supabase is not configured or for guest sessions.
"""

from __future__ import annotations

import json
import logging
import os
import pickle
import sqlite3
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Ensure persistent local data directories exist
DATA_DIR = Path(__file__).parent / "data"
INDEXES_DIR = DATA_DIR / "indexes"
MANUALS_DIR = DATA_DIR / "manuals"

DATA_DIR.mkdir(parents=True, exist_ok=True)
INDEXES_DIR.mkdir(parents=True, exist_ok=True)
MANUALS_DIR.mkdir(parents=True, exist_ok=True)

SQLITE_DB_PATH = DATA_DIR / "app.db"

_supabase_client = None


def get_supabase_client() -> Any | None:
    """Initialize or return the cached Supabase service-role server client."""
    global _supabase_client
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    if not url or not key:
        return None

    if _supabase_client is None:
        try:
            from supabase import create_client

            _supabase_client = create_client(url, key)
            logger.info("Initialized Supabase service-role client.")
        except Exception as exc:
            logger.exception("Failed to initialize Supabase client: %s", exc)
            return None

    return _supabase_client


def _get_sqlite_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_sqlite_db() -> None:
    """Initialize local SQLite database tables."""
    with _get_sqlite_connection() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            full_name TEXT,
            avatar_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            file_path TEXT,
            file_size INTEGER DEFAULT 0,
            pages INTEGER DEFAULT 0,
            words INTEGER DEFAULT 0,
            chunks_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'indexed',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS document_chunks (
            id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            page INTEGER NOT NULL,
            text TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            document_id TEXT,
            title TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            sender TEXT NOT NULL,
            content TEXT NOT NULL,
            mode TEXT DEFAULT 'llm',
            sources_json TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS collections (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS document_collections (
            document_id TEXT NOT NULL,
            collection_id TEXT NOT NULL,
            PRIMARY KEY (document_id, collection_id)
        );
        """)
        conn.commit()


# Initialize SQLite on import
init_sqlite_db()


# ====================================================================
# Unified Document Operations
# ====================================================================

def db_list_documents(user_id: str) -> list[dict[str, Any]]:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            res = (
                client.table("documents")
                .select("id, name, file_size, pages, words, chunks_count, status, created_at")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .execute()
            )
            return [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "file_size": row.get("file_size", 0),
                    "pages": row.get("pages", 0),
                    "words": row.get("words", 0),
                    "chunks": row.get("chunks_count", 0),
                    "status": row.get("status", "indexed"),
                    "created_at": row.get("created_at"),
                }
                for row in res.data
            ]
        except Exception as exc:
            logger.exception("Supabase db_list_documents failed: %s", exc)

    with _get_sqlite_connection() as conn:
        rows = conn.execute(
            """SELECT id, name, file_size, pages, words, chunks_count as chunks, status, created_at
               FROM documents WHERE user_id = ? ORDER BY created_at DESC""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def db_insert_document(
    doc_id: str,
    user_id: str,
    filename: str,
    file_size: int,
    pages: int,
    words: int,
    chunks: list[dict[str, Any]],
    pdf_bytes: bytes | None = None,
) -> None:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            client.table("documents").insert({
                "id": doc_id,
                "user_id": user_id,
                "name": filename,
                "file_size": file_size,
                "pages": pages,
                "words": words,
                "chunks_count": len(chunks),
                "status": "indexed",
            }).execute()

            chunk_records = [
                {
                    "id": str(uuid.uuid4()),
                    "document_id": doc_id,
                    "chunk_index": idx,
                    "page": chunk.get("page", 1),
                    "text": chunk.get("text", ""),
                }
                for idx, chunk in enumerate(chunks)
            ]
            if chunk_records:
                client.table("document_chunks").insert(chunk_records).execute()

            if pdf_bytes:
                storage_path = f"{user_id}/{doc_id}.pdf"
                try:
                    client.storage.from_("manuals").upload(
                        storage_path,
                        pdf_bytes,
                        file_options={"content-type": "application/pdf", "upsert": "true"},
                    )
                except Exception as st_exc:
                    logger.warning("Supabase storage upload warning: %s", st_exc)
        except Exception as exc:
            logger.exception("Supabase db_insert_document failed: %s", exc)

    with _get_sqlite_connection() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO documents (id, user_id, name, file_size, pages, words, chunks_count, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'indexed')""",
            (doc_id, user_id, filename, file_size, pages, words, len(chunks)),
        )
        for idx, chunk in enumerate(chunks):
            conn.execute(
                """INSERT OR REPLACE INTO document_chunks (id, document_id, chunk_index, page, text)
                   VALUES (?, ?, ?, ?, ?)""",
                (str(uuid.uuid4()), doc_id, idx, chunk.get("page", 1), chunk.get("text", "")),
            )
        conn.commit()

    if pdf_bytes:
        local_file = MANUALS_DIR / f"{doc_id}.pdf"
        with open(local_file, "wb") as f:
            f.write(pdf_bytes)


def db_get_document(doc_id: str, user_id: str | None = None) -> dict[str, Any] | None:
    client = get_supabase_client()
    if client and user_id and not user_id.startswith("guest"):
        try:
            res = client.table("documents").select("id, user_id, name, file_size, pages, words, chunks_count, status, created_at").eq("id", doc_id).eq("user_id", user_id).execute()
            if res.data:
                row = res.data[0]
                return {
                    "id": row["id"],
                    "user_id": row["user_id"],
                    "name": row["name"],
                    "file_size": row.get("file_size", 0),
                    "pages": row.get("pages", 0),
                    "words": row.get("words", 0),
                    "chunks": row.get("chunks_count", 0),
                    "status": row.get("status", "indexed"),
                    "created_at": row.get("created_at"),
                }
        except Exception as exc:
            logger.exception("Supabase db_get_document failed: %s", exc)

    with _get_sqlite_connection() as conn:
        if user_id:
            row = conn.execute(
                "SELECT id, user_id, name, file_size, pages, words, chunks_count as chunks, status, created_at FROM documents WHERE id = ? AND user_id = ?",
                (doc_id, user_id),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id, user_id, name, file_size, pages, words, chunks_count as chunks, status, created_at FROM documents WHERE id = ?",
                (doc_id,),
            ).fetchone()

    return dict(row) if row else None


def db_delete_document(doc_id: str, user_id: str) -> bool:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            existing = db_get_document(doc_id, user_id)
            if existing:
                client.table("document_chunks").delete().eq("document_id", doc_id).execute()
                client.table("documents").delete().eq("id", doc_id).eq("user_id", user_id).execute()
                try:
                    client.storage.from_("manuals").remove([f"{user_id}/{doc_id}.pdf"])
                except Exception as st_exc:
                    logger.warning("Supabase storage delete warning: %s", st_exc)
        except Exception as exc:
            logger.exception("Supabase db_delete_document failed: %s", exc)

    with _get_sqlite_connection() as conn:
        conn.execute("DELETE FROM document_chunks WHERE document_id = ?", (doc_id,))
        conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, user_id))
        conn.commit()

    delete_faiss_index_from_disk(doc_id)
    local_pdf = MANUALS_DIR / f"{doc_id}.pdf"
    if local_pdf.exists():
        local_pdf.unlink(missing_ok=True)
    return True


def db_get_chunks_for_document(doc_id: str) -> list[dict[str, Any]]:
    client = get_supabase_client()
    if client:
        try:
            res = client.table("document_chunks").select("page, text").eq("document_id", doc_id).order("chunk_index", desc=False).execute()
            if res.data:
                return [{"page": row["page"], "text": row["text"]} for row in res.data]
        except Exception as exc:
            logger.exception("Supabase db_get_chunks_for_document failed: %s", exc)

    with _get_sqlite_connection() as conn:
        rows = conn.execute(
            "SELECT page, text FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC",
            (doc_id,),
        ).fetchall()
    return [{"page": row["page"], "text": row["text"]} for row in rows]


# ====================================================================
# Unified Conversation & Chat Operations
# ====================================================================

def db_list_conversations(user_id: str) -> list[dict[str, Any]]:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            res = (
                client.table("conversations")
                .select("id, user_id, document_id, title, created_at, updated_at, documents!conversations_document_id_fkey(name)")
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .execute()
            )
            convs = []
            for row in res.data:
                doc_info = row.get("documents")
                doc_name = doc_info.get("name") if isinstance(doc_info, dict) else None
                convs.append({
                    "id": row["id"],
                    "user_id": row["user_id"],
                    "document_id": row.get("document_id"),
                    "title": row.get("title", "New Conversation"),
                    "created_at": row.get("created_at"),
                    "updated_at": row.get("updated_at"),
                    "document_name": doc_name,
                })
            return convs
        except Exception as exc:
            logger.exception("Supabase db_list_conversations failed: %s", exc)

    with _get_sqlite_connection() as conn:
        rows = conn.execute(
            """SELECT c.id, c.user_id, c.document_id, c.title, c.created_at, c.updated_at,
                      d.name as document_name
               FROM conversations c
               LEFT JOIN documents d ON c.document_id = d.id
               WHERE c.user_id = ?
               ORDER BY c.updated_at DESC""",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def db_create_conversation(conv_id: str, user_id: str, document_id: str | None, title: str) -> dict[str, Any]:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            client.table("conversations").insert({
                "id": conv_id,
                "user_id": user_id,
                "document_id": document_id,
                "title": title,
            }).execute()
        except Exception as exc:
            logger.exception("Supabase db_create_conversation failed: %s", exc)

    with _get_sqlite_connection() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO conversations (id, user_id, document_id, title) VALUES (?, ?, ?, ?)",
            (conv_id, user_id, document_id, title),
        )
        conn.commit()

    return {"id": conv_id, "user_id": user_id, "document_id": document_id, "title": title}


def db_get_conversation(conv_id: str, user_id: str) -> dict[str, Any] | None:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            res = (
                client.table("conversations")
                .select("id, user_id, document_id, title, created_at, updated_at, documents!conversations_document_id_fkey(name, pages, words, chunks_count)")
                .eq("id", conv_id)
                .eq("user_id", user_id)
                .execute()
            )
            if res.data:
                conv_row = res.data[0]
                doc_info = conv_row.get("documents") or {}
                msg_res = (
                    client.table("chat_messages")
                    .select("id, sender, content, mode, sources_json, created_at")
                    .eq("conversation_id", conv_id)
                    .order("created_at", desc=False)
                    .execute()
                )
                messages = []
                for m in msg_res.data:
                    item = {
                        "id": m["id"],
                        "sender": m["sender"],
                        "content": m["content"],
                        "mode": m.get("mode", "llm"),
                        "created_at": m.get("created_at"),
                    }
                    sources_val = m.get("sources_json")
                    if isinstance(sources_val, str):
                        try:
                            item["sources"] = json.loads(sources_val)
                        except Exception:
                            item["sources"] = []
                    elif isinstance(sources_val, list):
                        item["sources"] = sources_val
                    else:
                        item["sources"] = []
                    messages.append(item)

                return {
                    "id": conv_row["id"],
                    "user_id": conv_row["user_id"],
                    "document_id": conv_row.get("document_id"),
                    "title": conv_row.get("title", "New Conversation"),
                    "created_at": conv_row.get("created_at"),
                    "updated_at": conv_row.get("updated_at"),
                    "document_name": doc_info.get("name") if isinstance(doc_info, dict) else None,
                    "pages": doc_info.get("pages", 0) if isinstance(doc_info, dict) else 0,
                    "words": doc_info.get("words", 0) if isinstance(doc_info, dict) else 0,
                    "chunks": doc_info.get("chunks_count", 0) if isinstance(doc_info, dict) else 0,
                    "messages": messages,
                }
        except Exception as exc:
            logger.exception("Supabase db_get_conversation failed: %s", exc)

    with _get_sqlite_connection() as conn:
        conv = conn.execute(
            """SELECT c.id, c.user_id, c.document_id, c.title, c.created_at, c.updated_at,
                      d.name as document_name, d.pages, d.words, d.chunks_count as chunks
               FROM conversations c
               LEFT JOIN documents d ON c.document_id = d.id
               WHERE c.id = ? AND c.user_id = ?""",
            (conv_id, user_id),
        ).fetchone()

        if not conv:
            return None

        msg_rows = conn.execute(
            "SELECT id, sender, content, mode, sources_json, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,),
        ).fetchall()

    messages = []
    for m in msg_rows:
        item = dict(m)
        try:
            item["sources"] = json.loads(item.get("sources_json") or "[]")
        except Exception:
            item["sources"] = []
        messages.append(item)

    conv_dict = dict(conv)
    conv_dict["messages"] = messages
    return conv_dict


def db_save_chat_messages(
    conversation_id: str,
    user_id: str,
    question: str,
    answer_data: dict[str, Any],
    new_title: str | None = None,
) -> None:
    client = get_supabase_client()
    user_msg_id = str(uuid.uuid4())
    assistant_msg_id = str(uuid.uuid4())

    if client and not user_id.startswith("guest"):
        try:
            client.table("chat_messages").insert([
                {
                    "id": user_msg_id,
                    "conversation_id": conversation_id,
                    "sender": "user",
                    "content": question,
                },
                {
                    "id": assistant_msg_id,
                    "conversation_id": conversation_id,
                    "sender": "assistant",
                    "content": answer_data["answer"],
                    "mode": answer_data.get("mode", "llm"),
                    "sources_json": answer_data.get("sources", []),
                },
            ]).execute()

            update_dict: dict[str, Any] = {}
            if new_title:
                update_dict["title"] = new_title
            if update_dict:
                client.table("conversations").update(update_dict).eq("id", conversation_id).eq("user_id", user_id).execute()
        except Exception as exc:
            logger.exception("Supabase db_save_chat_messages failed: %s", exc)

    with _get_sqlite_connection() as conn:
        conn.execute(
            "INSERT INTO chat_messages (id, conversation_id, sender, content) VALUES (?, ?, 'user', ?)",
            (user_msg_id, conversation_id, question),
        )
        conn.execute(
            """INSERT INTO chat_messages (id, conversation_id, sender, content, mode, sources_json)
               VALUES (?, ?, 'assistant', ?, ?, ?)""",
            (
                assistant_msg_id,
                conversation_id,
                answer_data["answer"],
                answer_data.get("mode", "llm"),
                json.dumps(answer_data.get("sources", [])),
            ),
        )
        if new_title:
            conn.execute(
                "UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
                (new_title, conversation_id, user_id),
            )
        else:
            conn.execute(
                "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
                (conversation_id, user_id),
            )
        conn.commit()


def db_delete_conversation(conv_id: str, user_id: str) -> bool:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            client.table("chat_messages").delete().eq("conversation_id", conv_id).execute()
            client.table("conversations").delete().eq("id", conv_id).eq("user_id", user_id).execute()
        except Exception as exc:
            logger.exception("Supabase db_delete_conversation failed: %s", exc)

    with _get_sqlite_connection() as conn:
        conn.execute("DELETE FROM chat_messages WHERE conversation_id = ?", (conv_id,))
        conn.execute("DELETE FROM conversations WHERE id = ? AND user_id = ?", (conv_id, user_id))
        conn.commit()
    return True


# ====================================================================
# Analytics & Collections Real Operations
# ====================================================================

def db_get_analytics(user_id: str) -> dict[str, Any]:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            doc_res = client.table("documents").select("pages, words, chunks_count").eq("user_id", user_id).execute()
            doc_count = len(doc_res.data)
            pages_sum = sum(d.get("pages", 0) for d in doc_res.data)
            words_sum = sum(d.get("words", 0) for d in doc_res.data)
            chunks_sum = sum(d.get("chunks_count", 0) for d in doc_res.data)

            conv_res = client.table("conversations").select("id").eq("user_id", user_id).execute()
            conv_ids = [c["id"] for c in conv_res.data]
            conv_count = len(conv_ids)
            q_count = 0
            if conv_ids:
                q_res = client.table("chat_messages").select("id").in_("conversation_id", conv_ids).eq("sender", "user").execute()
                q_count = len(q_res.data)

            return {
                "total_documents": doc_count,
                "total_pages": pages_sum,
                "total_chunks": chunks_sum,
                "total_words": words_sum,
                "total_conversations": conv_count,
                "total_questions": q_count,
                "avg_chunks_per_doc": round(chunks_sum / doc_count, 1) if doc_count > 0 else 0,
            }
        except Exception as exc:
            logger.exception("Supabase db_get_analytics failed: %s", exc)

    with _get_sqlite_connection() as conn:
        doc_count = conn.execute("SELECT COUNT(*) FROM documents WHERE user_id = ?", (user_id,)).fetchone()[0]
        pages_sum = conn.execute("SELECT COALESCE(SUM(pages), 0) FROM documents WHERE user_id = ?", (user_id,)).fetchone()[0]
        chunks_sum = conn.execute("SELECT COALESCE(SUM(chunks_count), 0) FROM documents WHERE user_id = ?", (user_id,)).fetchone()[0]
        words_sum = conn.execute("SELECT COALESCE(SUM(words), 0) FROM documents WHERE user_id = ?", (user_id,)).fetchone()[0]

        conv_count = conn.execute("SELECT COUNT(*) FROM conversations WHERE user_id = ?", (user_id,)).fetchone()[0]
        q_count = conn.execute(
            """SELECT COUNT(*) FROM chat_messages cm
               JOIN conversations c ON cm.conversation_id = c.id
               WHERE c.user_id = ? AND cm.sender = 'user'""",
            (user_id,),
        ).fetchone()[0]

    return {
        "total_documents": doc_count,
        "total_pages": pages_sum,
        "total_chunks": chunks_sum,
        "total_words": words_sum,
        "total_conversations": conv_count,
        "total_questions": q_count,
        "avg_chunks_per_doc": round(chunks_sum / doc_count, 1) if doc_count > 0 else 0,
    }


def db_list_collections(user_id: str) -> list[dict[str, Any]]:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            res = client.table("collections").select("id, name, description, created_at").eq("user_id", user_id).order("created_at", desc=True).execute()
            return [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "description": row.get("description", ""),
                    "created_at": row.get("created_at"),
                }
                for row in res.data
            ]
        except Exception as exc:
            logger.exception("Supabase db_list_collections failed: %s", exc)

    with _get_sqlite_connection() as conn:
        rows = conn.execute(
            "SELECT id, name, description, created_at FROM collections WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def db_create_collection(col_id: str, user_id: str, name: str, description: str) -> dict[str, Any]:
    client = get_supabase_client()
    if client and not user_id.startswith("guest"):
        try:
            client.table("collections").insert({
                "id": col_id,
                "user_id": user_id,
                "name": name,
                "description": description,
            }).execute()
        except Exception as exc:
            logger.exception("Supabase db_create_collection failed: %s", exc)

    with _get_sqlite_connection() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO collections (id, user_id, name, description) VALUES (?, ?, ?, ?)",
            (col_id, user_id, name, description),
        )
        conn.commit()

    return {"id": col_id, "name": name, "description": description}


# ====================================================================
# FAISS Index Operations (disk persistence)
# ====================================================================

def save_faiss_index_to_disk(document_id: str, retriever: Any) -> bool:
    """Save FAISS index and documents metadata to disk."""
    try:
        index_file = INDEXES_DIR / f"{document_id}.faiss"
        pkl_file = INDEXES_DIR / f"{document_id}.pkl"

        import faiss

        faiss.write_index(retriever.index, str(index_file))

        docs_list = getattr(retriever, "documents", getattr(retriever, "docs", []))
        dim_val = getattr(retriever, "dimension", getattr(retriever, "dim", 384))

        with open(pkl_file, "wb") as f:
            pickle.dump({
                "documents": docs_list,
                "dimension": dim_val,
            }, f)

        logger.info("Saved FAISS index to disk for document: %s", document_id)
        return True
    except Exception as exc:
        logger.exception("Failed to save FAISS index for document %s: %s", document_id, exc)
        return False


def load_faiss_index_from_disk(document_id: str, embedding_model: Any = None) -> Any | None:
    """Load FAISS index and documents metadata from disk."""
    index_file = INDEXES_DIR / f"{document_id}.faiss"
    pkl_file = INDEXES_DIR / f"{document_id}.pkl"

    if not index_file.exists() or not pkl_file.exists():
        return None

    try:
        import faiss
        from backend.rag.retriever import FaissRetriever

        index = faiss.read_index(str(index_file))

        with open(pkl_file, "rb") as f:
            data = pickle.load(f)

        retriever = FaissRetriever(model=embedding_model)
        retriever.index = index
        docs_data = data.get("documents", data.get("docs", []))
        retriever.documents = docs_data
        retriever.docs = docs_data
        dim_val = data.get("dimension", data.get("dim", 384))
        retriever.dimension = dim_val
        retriever.dim = dim_val


        logger.info("Loaded FAISS index from disk for document: %s", document_id)
        return retriever
    except Exception as exc:
        logger.exception("Failed to load FAISS index for document %s: %s", document_id, exc)
        return None


def delete_faiss_index_from_disk(document_id: str) -> None:
    """Remove FAISS index files for a deleted document."""
    index_file = INDEXES_DIR / f"{document_id}.faiss"
    pkl_file = INDEXES_DIR / f"{document_id}.pkl"

    if index_file.exists():
        index_file.unlink(missing_ok=True)
    if pkl_file.exists():
        pkl_file.unlink(missing_ok=True)
