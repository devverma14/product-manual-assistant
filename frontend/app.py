import streamlit as st

from backend.rag.pdf_loader import load_pdf_bytes
from backend.rag.chunker import chunk_text
from backend.rag.retriever import FaissRetriever
from backend.rag.generator import generate_answer
from backend.scaledown.compressor import compress_context


# -----------------------------
# PAGE CONFIG
# -----------------------------
st.set_page_config(
    page_title="NeoManual AI Assistant",
    page_icon="📘",
    layout="wide"
)

# -----------------------------
# HEADER
# -----------------------------
st.markdown("""
# 📘 NeoManual AI Assistant  
### Product Manual Question Answering using **RAG + ScaleDown Compression**
Upload any PDF manual and ask questions instantly.
""")

st.divider()


# -----------------------------
# SESSION STATE
# -----------------------------
if "retriever" not in st.session_state:
    st.session_state["retriever"] = None

if "history" not in st.session_state:
    st.session_state["history"] = []


# -----------------------------
# SIDEBAR SETTINGS
# -----------------------------
st.sidebar.title("⚙️ Settings")

top_k = st.sidebar.slider("Retrieved Chunks (k)", 3, 10, 5)
chunk_size = st.sidebar.slider("Chunk Size", 600, 1500, 900)
overlap = st.sidebar.slider("Chunk Overlap", 50, 300, 120)

st.sidebar.divider()
st.sidebar.info("Built with FAISS + Sentence Transformers + ScaleDown")


# -----------------------------
# FILE UPLOAD SECTION
# -----------------------------
st.subheader("📂 Upload Product Manual")

uploaded = st.file_uploader(
    "Upload a PDF manual",
    type=["pdf"]
)

if uploaded is not None:

    bytes_data = uploaded.read()

    with st.spinner("📄 Reading manual..."):
        text, pages = load_pdf_bytes(bytes_data)

    if len(text.strip()) < 50:
        st.error("❌ This PDF has no readable text (scanned image PDF).")
        st.stop()

    st.success(f"✅ Manual Loaded Successfully ({pages} pages)")

    # Chunking
    with st.spinner("✂️ Chunking manual text..."):
        chunks = chunk_text(text, chunk_size=chunk_size, overlap=overlap)

    st.info(f"Total Chunks Created: {len(chunks)}")

    # Index build
    with st.spinner("🔍 Building Vector Index..."):
        retriever = FaissRetriever()
        retriever.add_documents(chunks)

    st.session_state["retriever"] = retriever
    st.success("✅ Manual Indexed & Ready for Questions!")


# -----------------------------
# QUESTION ASKING
# -----------------------------
st.divider()
st.subheader("💬 Ask Questions")

question = st.text_input("Type your question here:")

if st.button("Ask 🚀") and question:

    retriever = st.session_state.get("retriever")

    if retriever is None:
        st.warning("Upload a manual first!")
        st.stop()

    # Retrieve
    with st.spinner("🔎 Searching manual..."):
        results = retriever.retrieve(question, k=top_k)

    contexts = [{"text": doc["text"]} for _, doc in results]

    # Compress
    combined = "\n\n".join([c["text"] for c in contexts])
    compressed, cm = compress_context(combined)

    # Generate
    answer = generate_answer(question, [{"text": compressed}])

    # Save history
    st.session_state["history"].append((question, answer["answer"]))

    # -----------------------------
    # OUTPUT UI
    # -----------------------------
    st.markdown("## ✅ Answer")
    st.success(answer["answer"])

    st.markdown("## 📉 Compression Metrics")
    col1, col2, col3 = st.columns(3)

    col1.metric("Tokens Before", cm["tokens_before"])
    col2.metric("Tokens After", cm["tokens_after"])
    col3.metric("Savings %", f"{cm['percent_savings']}%")

    # Retrieved Chunks Expandable
    st.markdown("## 📌 Retrieved Context Chunks")

    for i, (score, doc) in enumerate(results):
        with st.expander(f"Chunk {i+1} | Similarity Score: {score:.4f}"):
            st.write(doc["text"][:800] + "...")


# -----------------------------
# CHAT HISTORY
# -----------------------------
st.divider()
st.subheader("🕘 Question History")

if st.session_state["history"]:
    for q, a in reversed(st.session_state["history"][-5:]):
        st.markdown(f"**Q:** {q}")
        st.markdown(f"➡️ {a}")
        st.divider()
else:
    st.caption("No questions asked yet.")
