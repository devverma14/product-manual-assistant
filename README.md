# Product Manual Assistant

A Streamlit app that answers questions from uploaded product manuals using PDF text extraction, chunking, FAISS semantic retrieval, and ScaleDown-style context compression.

## Project layout

```text
product-manual-assistant/
├── app.py                    # Stable Streamlit entry point
├── frontend/
│   └── app.py                # Streamlit interface
├── backend/
│   ├── dashboard/            # Manual metrics
│   ├── rag/                  # PDF loading, chunking, retrieval, answers
│   └── scaledown/            # Context compression and token metrics
├── sample_data/
├── requirements.txt
└── README.md
```

The UI stays in Streamlit. Its backend is a set of Python modules in the same process; a separate HTTP API is not needed for this single-client app. Compression metrics and answer generation use the same compressed retrieved context, while the UI still shows the original retrieved chunks.

## Run locally

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
streamlit run app.py
```

On macOS or Linux, activate the environment with `source .venv/bin/activate`.

Upload a text-based PDF manual, wait for indexing, then enter a question. Scanned image-only PDFs are not OCR processed.

## Update the existing GitHub repository

This project is prepared for the existing public repository: <https://github.com/DevVerma14/product-manual-assistant>. Updating its current checkout and pushing to its existing `origin` keeps the repository URL unchanged. Do not create a new repository or replace its `.git` folder.

1. Download and extract the upgraded project ZIP into a temporary folder.
2. Open PowerShell in your existing local clone of `product-manual-assistant`.
3. Copy the extracted project files over the clone, remove the old module folders, and push the current branch:

```powershell
# Run from the existing product-manual-assistant clone.
Copy-Item -Path "C:\path\to\product-manual-assistant-main\*" -Destination . -Recurse -Force
git rm -r --ignore-unmatch rag scaledown dashboard
git status
git add -A
git commit -m "Organize app into frontend and backend"
git push origin HEAD
```

Replace `C:\path\to\product-manual-assistant-main` with the folder where you extracted the ZIP. Check `git status` before committing and make sure the remote is still the existing repository with `git remote -v`. The push uses the currently checked-out branch and existing `origin`.

## Notes

- `requirements.txt` retains the project's original dependencies.
- No paid model API key is required by the current extractive answer generator.
- Keep secrets and `.env` files out of the public repository.
