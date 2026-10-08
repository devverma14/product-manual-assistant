import os
os.environ["USE_TF"] = "0"
os.environ["USE_TORCH"] = "1"
import unittest
from unittest.mock import patch

from backend.rag.chunker import chunk_text
from backend.rag.generator import generate_answer
from backend.scaledown.compressor import compress_context


class ChunkerTests(unittest.TestCase):
    def test_chunks_preserve_content_and_overlap(self):
        chunks = chunk_text("one two three four five six", chunk_size=4, overlap=1)
        self.assertEqual(chunks[0]["text"], "one two three four")
        self.assertEqual(chunks[1]["text"], "four five six")

    def test_rejects_overlap_that_would_not_make_progress(self):
        with self.assertRaises(ValueError):
            chunk_text("one two", chunk_size=2, overlap=2)


class GeneratorTests(unittest.TestCase):
    def test_missing_key_returns_cited_manual_evidence(self):
        contexts = [{"page": 7, "text": "Hold the power button for five seconds to restart the unit."}]
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            result = generate_answer("How do I restart it?", contexts)
        self.assertEqual(result["mode"], "extractive")
        self.assertIn("[Page 7]", result["answer"])
        self.assertIn("power button", result["answer"])


class CompressionTests(unittest.TestCase):
    def test_removes_duplicate_sentences_and_reports_metrics(self):
        text = "Disconnect power before cleaning. Disconnect power before cleaning."
        compressed, metrics = compress_context(text, question="cleaning")
        self.assertEqual(compressed, "Disconnect power before cleaning.")
        self.assertGreater(metrics["tokens_before"], metrics["tokens_after"])
        self.assertGreater(metrics["percent_savings"], 0)



class LanguageDetectionTests(unittest.TestCase):
    def test_detects_hinglish_roman_script(self):
        from backend.rag.generator import detect_response_language
        res = detect_response_language("Camera ko Wi-Fi se kaise connect karun?")
        self.assertEqual(res["language"], "Hinglish")
        self.assertEqual(res["script"], "Latin/Roman")

    def test_explicit_hindi_override(self):
        from backend.rag.generator import detect_response_language
        res = detect_response_language("Camera ko Wi-Fi se kaise connect karun? Hindi mein batao.")
        self.assertEqual(res["language"], "Hindi")
        self.assertEqual(res["script"], "Devanagari")

    def test_explicit_english_override(self):
        from backend.rag.generator import detect_response_language
        res = detect_response_language("Explain in English")
        self.assertEqual(res["language"], "English")

    def test_explicit_spanish_override(self):
        from backend.rag.generator import detect_response_language
        res = detect_response_language("Explícamelo en español")
        self.assertEqual(res["language"], "Spanish")

    def test_devanagari_script_detection(self):
        from backend.rag.generator import detect_response_language
        res = detect_response_language("कैमरा Wi-Fi से कैसे कनेक्ट करें?")
        self.assertEqual(res["language"], "Hindi")
        self.assertEqual(res["script"], "Devanagari")


class PDFLoaderTests(unittest.TestCase):
    def test_text_pdf_skips_ocr_on_sparse_non_image_page(self):
        import fitz
        from backend.rag.pdf_loader import load_pdf_pages_bytes
        doc = fitz.open()
        page1 = doc.new_page()
        page1.insert_text((50, 50), "This is a normal product manual page with sufficient text length.")
        page2 = doc.new_page()
        page2.insert_text((50, 50), "Sparse")
        pdf_bytes = doc.tobytes()

        with patch.object(fitz.Page, "get_textpage_ocr") as mock_ocr:
            pages = load_pdf_pages_bytes(pdf_bytes)
            self.assertEqual(len(pages), 2)
            self.assertEqual(pages[0]["page"], 1)
            self.assertIn("product manual", pages[0]["text"])
            self.assertEqual(pages[1]["text"], "Sparse")
            mock_ocr.assert_not_called()

    def test_sparse_page_with_images_triggers_ocr(self):
        import fitz
        from backend.rag.pdf_loader import load_pdf_pages_bytes
        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((50, 50), "Sparse")
        pix = fitz.Pixmap(fitz.csRGB, 50, 50, bytes(7500), False)
        page.insert_image(page.rect, pixmap=pix)
        pdf_bytes = doc.tobytes()

        real_get_text = fitz.Page.get_text
        def custom_get_text(self, *args, **kwargs):
            if kwargs.get("textpage") is not None:
                return "OCR extracted text"
            return real_get_text(self, *args, **kwargs)

        with patch.object(fitz.Page, "get_textpage_ocr") as mock_ocr, \
             patch.object(fitz.Page, "get_text", custom_get_text):
            pages = load_pdf_pages_bytes(pdf_bytes)
            self.assertEqual(len(pages), 1)
            self.assertEqual(pages[0]["text"], "OCR extracted text")
            mock_ocr.assert_called_once()


class SourceFilteringTests(unittest.TestCase):
    def test_filters_weak_sources_and_retains_strong(self):
        from backend.api.main import filter_relevant_sources
        raw_sources = [
            {"page": 41, "text": "Fridge temp setting 1 to 7 degrees C.", "score": 0.65},
            {"page": 41, "text": "Freezer temp setting -15 to -23 degrees C.", "score": 0.58},
            {"page": 47, "text": "Wi-Fi network setup guide.", "score": 0.22},
            {"page": 31, "text": "Cleaning door seals.", "score": 0.18},
        ]
        filtered = filter_relevant_sources(raw_sources)
        self.assertEqual(len(filtered), 2)
        self.assertEqual([s["page"] for s in filtered], [41, 41])

    def test_extract_cited_pages(self):
        from backend.api.main import extract_cited_pages
        text = "Set fridge temperature [Page 41] and freezer temperature [Page 41]. See also Pages 39, 40."
        self.assertEqual(extract_cited_pages(text), [39, 40, 41])

    def test_filter_answer_grounded_sources_only_returns_cited_pages(self):
        from backend.api.main import filter_answer_grounded_sources
        raw_sources = [
            {"page": 41, "text": "Fridge temp setting", "score": 0.68},
            {"page": 19, "text": "Site installation", "score": 0.61},
            {"page": 11, "text": "Usage cautions", "score": 0.52},
            {"page": 42, "text": "Beverage zone", "score": 0.51},
            {"page": 39, "text": "Initial setup", "score": 0.51},
        ]
        answer = "The fridge temperature can be set from 1 to 7 °C [Page 41]."
        filtered = filter_answer_grounded_sources(raw_sources, answer)
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["page"], 41)

    def test_filter_answer_grounded_sources_deduplicates_pages(self):
        from backend.api.main import filter_answer_grounded_sources
        raw_sources = [
            {"page": 41, "text": "Fridge temp setting chunk 1", "score": 0.68},
            {"page": 41, "text": "Fridge temp setting chunk 2", "score": 0.55},
            {"page": 39, "text": "Initial setup", "score": 0.50},
        ]
        answer = "Refer to [Page 41] for details."
        filtered = filter_answer_grounded_sources(raw_sources, answer)
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["page"], 41)
        self.assertEqual(filtered[0]["score"], 0.68)

    def test_filter_answer_grounded_sources_falls_back_when_no_citations(self):
        from backend.api.main import filter_answer_grounded_sources
        raw_sources = [
            {"page": 41, "text": "Fridge temp setting", "score": 0.68},
            {"page": 39, "text": "Initial setup", "score": 0.50},
        ]
        answer = "General information without explicit page citation."
        filtered = filter_answer_grounded_sources(raw_sources, answer)
        self.assertGreater(len(filtered), 0)


class PDFLimitTests(unittest.TestCase):
    def test_pdf_exceeding_50_pages_rejected(self):
        import fitz
        from backend.rag.pdf_loader import load_pdf_pages_bytes

        doc = fitz.open()
        for i in range(51):
            page = doc.new_page()
            page.insert_text((50, 50), f"Page content {i+1}")
        pdf_bytes = doc.tobytes()
        doc.close()

        with self.assertRaises(ValueError) as ctx:
            load_pdf_pages_bytes(pdf_bytes)
        self.assertEqual(str(ctx.exception), "PDF has too many pages. Maximum allowed is 50 pages.")

    def test_pdf_under_50_pages_accepted(self):
        import fitz
        from backend.rag.pdf_loader import load_pdf_pages_bytes

        doc = fitz.open()
        for i in range(5):
            page = doc.new_page()
            page.insert_text((50, 50), f"Page content {i+1} with sufficient length for text extraction.")
        pdf_bytes = doc.tobytes()
        doc.close()

        pages = load_pdf_pages_bytes(pdf_bytes)
        self.assertEqual(len(pages), 5)

    def test_api_upload_rejected_if_over_10mb(self):
        from fastapi.testclient import TestClient
        from backend.api.main import app

        client = TestClient(app)
        large_payload = b"%PDF-1.4 " + b"X" * (10 * 1024 * 1024 + 10)
        files = {"file": ("large_manual.pdf", large_payload, "application/pdf")}
        headers = {"X-Guest-Session-ID": "test_guest_limits"}

        response = client.post("/api/manuals", files=files, headers=headers)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(
            response.json()["detail"],
            "PDF file is too large. Maximum allowed size is 10 MB.",
        )

    def test_api_upload_rejected_if_over_50_pages(self):
        import fitz
        from fastapi.testclient import TestClient
        from backend.api.main import app

        doc = fitz.open()
        for i in range(51):
            page = doc.new_page()
            page.insert_text((50, 50), f"Page content {i+1}")
        pdf_bytes = doc.tobytes()
        doc.close()

        client = TestClient(app)
        files = {"file": ("long_manual.pdf", pdf_bytes, "application/pdf")}
        headers = {"X-Guest-Session-ID": "test_guest_limits"}

        response = client.post("/api/manuals", files=files, headers=headers)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.json()["detail"],
            "PDF has too many pages. Maximum allowed is 50 pages.",
        )

    def test_api_upload_normal_pdf_accepted(self):
        import fitz
        from unittest.mock import MagicMock, patch
        from fastapi.testclient import TestClient
        from backend.api.main import app

        doc = fitz.open()
        page1 = doc.new_page()
        page1.insert_text((50, 50), "Product Manual Section 1: Powering on the unit safely.")
        page2 = doc.new_page()
        page2.insert_text((50, 50), "Product Manual Section 2: Wi-Fi setup and device configuration steps.")
        pdf_bytes = doc.tobytes()
        doc.close()

        mock_retriever = MagicMock()
        with patch("backend.api.main._create_retriever", return_value=mock_retriever), \
             patch("backend.api.main.save_faiss_index_to_disk"):
            client = TestClient(app)
            files = {"file": ("valid_manual.pdf", pdf_bytes, "application/pdf")}
            headers = {"X-Guest-Session-ID": "test_guest_limits"}

            response = client.post("/api/manuals", files=files, headers=headers)
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertEqual(data["pages"], 2)
            self.assertEqual(data["status"], "indexed")


class FastEmbedStartupTests(unittest.TestCase):
    def test_embedding_model_cached_reuse(self):
        import sys
        from unittest.mock import MagicMock
        from backend.api.main import _embedding_model

        mock_fastembed = MagicMock()
        mock_instance = MagicMock()
        mock_fastembed.TextEmbedding.return_value = mock_instance

        with patch.dict(sys.modules, {"fastembed": mock_fastembed}):
            _embedding_model.cache_clear()
            m1 = _embedding_model()
            m2 = _embedding_model()
            self.assertIs(m1, m2)
            mock_fastembed.TextEmbedding.assert_called_once()

    def test_lifespan_startup_initializes_model(self):
        from fastapi.testclient import TestClient
        from backend.api.main import app
        with patch("backend.api.main._embedding_model") as mock_init:
            with TestClient(app):
                mock_init.assert_called_once()

    def test_lifespan_startup_failure_raises(self):
        from fastapi.testclient import TestClient
        from backend.api.main import app
        with patch("backend.api.main._embedding_model", side_effect=RuntimeError("Model download failed")):
            with self.assertRaises(RuntimeError):
                with TestClient(app):
                    pass


if __name__ == "__main__":
    unittest.main()





