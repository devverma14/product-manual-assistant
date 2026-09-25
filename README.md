
# Product Manual Assistant
### AI-Powered Document Question Answering using Retrieval-Augmented Generation (RAG)

An AI-powered application that helps users understand product manuals by asking questions and receiving context-aware answers based on the information available in the documentation.

The project combines document processing, semantic retrieval, language model-based response generation, and text compression in a Streamlit application.

---

## Overview

Product manuals often contain detailed technical information that can be time-consuming to search through manually.

The Product Manual Assistant aims to simplify this process by allowing users to interact with product documentation through natural-language questions.

Using a Retrieval-Augmented Generation (RAG) pipeline, the application processes document content, retrieves relevant information for a query, and uses the retrieved context to generate an answer.

The application follows a modular architecture, separating the Streamlit frontend from backend components responsible for document processing, retrieval, generation, compression, and metrics.

## Key Features

- **Document Processing:** Load and process product documentation in PDF format.
- **Text Chunking:** Split document content into smaller chunks for retrieval.
- **Contextual Retrieval:** Retrieve relevant document content based on user queries.
- **AI-Powered Question Answering:** Generate responses using retrieved document context.
- **Text Compression:** Integrate ScaleDown functionality for text compression.
- **Interactive Interface:** Use a Streamlit-based UI to interact with the assistant.
- **Modular Architecture:** Keep frontend and backend components organized within a single repository.

## Tech Stack

| Category | Technologies |
|---|---|
| Programming Language | Python |
| Frontend | Streamlit |
| AI Architecture | Retrieval-Augmented Generation (RAG) |
| Document Processing | PDF processing, text chunking |
| Retrieval | Document retrieval components |
| Text Compression | ScaleDown integration |
| Version Control | Git, GitHub |

## System Architecture

The application follows a document question-answering workflow:

```text
                 User
                   |
                   v
          Streamlit Frontend
             frontend/app.py
                   |
                   v
          Document Processing
          PDF Loader & Chunker
                   |
                   v
          Document Retrieval
                   |
                   v
        Context-Based Generation
                   |
                   v
          ScaleDown Integration
                   |
                   v
          Response to User
```

The frontend provides the user interface, while the backend contains the modules used for document processing, retrieval, response generation, compression, and metrics.

## Project Structure

```text
product-manual-assistant/
│
├── frontend/
│   └── app.py
│
├── backend/
│   ├── dashboard/
│   │   └── metrics.py
│   │
│   ├── rag/
│   │   ├── pdf_loader.py
│   │   ├── chunker.py
│   │   ├── retriever.py
│   │   └── generator.py
│   │
│   └── scaledown/
│       └── compressor.py
│
├── sample_data/
│   └── sample_manual.txt
│
├── .gitignore
├── requirements.txt
└── README.md
```

## Getting Started

Follow the steps below to run the project locally.

### Prerequisites

- Python installed on your system
- pip package manager
- Git

### 1. Clone the repository

```bash
git clone https://github.com/DevVerma14/product-manual-assistant.git
cd product-manual-assistant
```

### 2. Create a virtual environment

For Windows PowerShell:

```powershell
python -m venv .venv
```

Activate the environment:

```powershell
.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```powershell
python -m pip install -r requirements.txt
```

### 4. Configure the environment

If you encounter the TensorFlow/Protobuf compatibility issue observed during local development, set the following environment variable in the same PowerShell terminal:

```powershell
$env:USE_TF="0"
```

This setting applies to the current PowerShell session.

### 5. Run the application

```powershell
python -m streamlit run frontend/app.py
```

Streamlit will start a local server and provide a URL to open the application in your browser.

For additional information, refer to the [Streamlit documentation](https://docs.streamlit.io/).

## Usage

1. Start the application using the command provided above.
2. Open the local Streamlit URL in your browser.
3. Upload a supported product manual through the application.
4. Enter a question related to the document.
5. Review the generated response based on the retrieved documentation.

The quality and relevance of responses depend on the document content, retrieval process, and configured language model.

## Future Enhancements

- Improve document retrieval and answer relevance.
- Expand support for additional document formats.
- Enhance the user interface and document management experience.
- Add systematic evaluation of retrieval quality and generated responses.
- Explore deployment options for wider accessibility.

## Author


Created with ❤️ by [DevVerma14](https://github.com/DevVerma14)
🔗 [Connect on LinkedIn](https://www.linkedin.com/in/dev-verma-b9b020263)


---



