# 🧠 Multimodal RAG Chat

A full-stack **Retrieval-Augmented Generation (RAG)** application that lets you upload documents, images, and videos, embed them into a vector database (Pinecone), and chat with your data using AI.

🔗 **Live Demo:** [embedding-rag-j7ow.onrender.com](https://embedding-rag-j7ow.onrender.com)

## ✨ Features

- **Multimodal Ingestion** — Upload PDFs, images (JPG/PNG/WebP), and videos (MP4/MOV/WebM) through the web UI or CLI
- **AI-Powered Processing** — Uses Google Gemini to analyze and extract content from every file type
- **Vector Search** — Embeds content using Gemini Embeddings and stores in Pinecone for semantic search
- **Conversational RAG** — Chat interface with context-aware answers powered by Groq LLM
- **Source Cards** — Every answer includes source reference cards with inline media previews
- **Real-time Progress** — NDJSON streaming shows live ingestion progress with per-file status
- **Mobile Ready** — Responsive UI wrapped with Capacitor for Android deployment

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │────▶│  Node.js API │────▶│   Pinecone   │
│  (Vanilla JS)│     │  (server.js) │     │ Vector Store │
└──────────────┘     └──────┬───────┘     └──────────────┘
                           │
                    ┌──────┴───────┐
                    │              │
              ┌─────▼─────┐ ┌─────▼─────┐
              │  Gemini    │ │   Groq    │
              │ Embeddings │ │    LLM    │
              │ + Analysis │ │ Generation│
              └────────────┘ └───────────┘
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vanilla JS, CSS (Manrope + Sora fonts) |
| **Backend** | Node.js (ESM, zero frameworks) |
| **Embeddings** | Google Gemini `gemini-embedding-2-preview` (1536d) |
| **Analysis** | Google Gemini `gemini-2.5-flash` (PDF/image/video understanding) |
| **Vector DB** | Pinecone (serverless, `cosine` similarity) |
| **LLM** | Groq `openai/gpt-oss-120b` |
| **File Upload** | Busboy (multipart/form-data) |
| **Mobile** | Capacitor (Android) |

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- API keys for: Gemini, Pinecone, Groq

### Setup

1. **Clone and install:**
   ```bash
   git clone https://github.com/nikhil0100kumar/embedding-rag.git
   cd embedding-rag
   npm install
   ```

2. **Configure environment:** Create a `.env` file:
   ```env
   GEMINI_API_KEY=your-gemini-key
   PINECONE_API_KEY=your-pinecone-key
   GROQ_API_KEY=your-groq-key

   EMBEDDING_MODEL=gemini-embedding-2-preview
   EMBEDDING_DIMENSION=1536
   INGESTION_MODEL=gemini-2.5-flash

   PINECONE_INDEX_NAME=multimodal-rag
   PINECONE_NAMESPACE=default

   GENERATION_MODEL=openai/gpt-oss-120b
   GROQ_BASE_URL=https://api.groq.com/openai/v1

   PORT=3000
   ```

3. **Start the server:**
   ```bash
   npm run dev
   ```

4. **Open in browser:** [http://localhost:3000](http://localhost:3000)

### CLI Ingestion

To ingest all files in the `data/` directory at once:

```bash
npm run ingest
```

## 📱 How It Works

### Upload Tab
1. Drag & drop or browse to select files (PDFs, images, videos)
2. Click "Upload & Ingest" to embed them into Pinecone
3. Real-time progress bar shows per-file ingestion status

### Chat Tab
1. Ask questions about your uploaded content
2. The system embeds your query → searches Pinecone → sends context to Groq LLM
3. Answers include source cards with inline media previews

## 📂 Project Structure

```
embedding-rag/
├── server.js            # HTTP server, API routes, RAG pipeline
├── ingestion-core.js    # File processing, Gemini analysis, Pinecone upsert
├── ingest.js            # CLI ingestion script
├── package.json
├── .env                 # API keys and configuration
├── public/
│   ├── index.html       # Main app shell
│   ├── app.js           # Frontend logic (upload, chat, rendering)
│   ├── styles.css       # UI styles (warm gradient theme)
│   └── runtime-config.js # Capacitor/LAN config
├── data/                # Uploaded files stored here
└── android/             # Capacitor Android project
```

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Service status and config |
| `GET` | `/api/assets` | List all uploaded files |
| `POST` | `/api/upload` | Upload & ingest files (NDJSON streaming) |
| `POST` | `/api/chat` | Send a message, get RAG response |

## 📝 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMINI_API_KEY` | Google Gemini API key | — |
| `PINECONE_API_KEY` | Pinecone API key | — |
| `GROQ_API_KEY` | Groq API key | — |
| `EMBEDDING_MODEL` | Gemini embedding model | `gemini-embedding-2-preview` |
| `EMBEDDING_DIMENSION` | Vector dimensions | `1536` |
| `INGESTION_MODEL` | Gemini analysis model | `gemini-2.5-flash` |
| `PINECONE_INDEX_NAME` | Pinecone index name | `multimodal-rag` |
| `GENERATION_MODEL` | Groq generation model | `openai/gpt-oss-120b` |
| `PORT` | Server port | `3000` |
| `TOP_K` | Number of vectors to retrieve | `10` |
| `MAX_SNIPPET_CHARS` | Max chars per context chunk | `800` |

## ☁️ Deploy to Render (Free Tier)

### Step-by-Step Guide

#### 1. Push code to GitHub

Make sure your code is pushed to a GitHub repository (e.g., `https://github.com/nikhil0100kumar/embedding-rag`).

#### 2. Create a Render account

Go to [render.com](https://render.com) and sign up with your GitHub account.

#### 3. Create a new Web Service

1. From the Render dashboard, click **"New +"** → **"Web Service"**
2. Connect your GitHub account if not already connected
3. Search for and select your `embedding-rag` repository
4. Click **"Connect"**

#### 4. Configure the service

| Setting | Value |
|---------|-------|
| **Name** | `embedding-rag` (or any name you prefer) |
| **Region** | Choose nearest to you (e.g., Oregon, Frankfurt) |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Instance Type** | **Free** |

#### 5. Add environment variables

In the **"Environment"** section, click **"Add Environment Variable"** for each:

| Key | Value |
|-----|-------|
| `GEMINI_API_KEY` | Your Google Gemini API key |
| `PINECONE_API_KEY` | Your Pinecone API key |
| `GROQ_API_KEY` | Your Groq API key |
| `EMBEDDING_MODEL` | `gemini-embedding-2-preview` |
| `EMBEDDING_DIMENSION` | `1536` |
| `EMBEDDING_NORMALIZE` | `true` |
| `INGESTION_MODEL` | `gemini-2.5-flash` |
| `PINECONE_INDEX_NAME` | `multimodal-rag` |
| `PINECONE_NAMESPACE` | `default` |
| `PINECONE_INDEX_HOST` | Your Pinecone index host URL |
| `GENERATION_MODEL` | `openai/gpt-oss-120b` |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` |
| `PORT` | `3000` |
| `CORS_ALLOW_ORIGIN` | `*` |

#### 6. Deploy

Click **"Create Web Service"**. Render will:
- Clone your repo
- Run `npm install`
- Start `node server.js`
- Give you a public URL like `https://embedding-rag.onrender.com`

#### 7. Verify deployment

Visit your Render URL and check:
- `https://your-app.onrender.com/` — should show the chat UI
- `https://your-app.onrender.com/api/health` — should return service status

### Free Tier Limitations

- **Spin down:** Free instances spin down after 15 minutes of inactivity. First request after sleep takes ~30 seconds.
- **Memory:** 512 MB RAM limit. Large video uploads may fail.
- **Storage:** Ephemeral disk — uploaded files in `data/` are lost on redeploy. Use the upload UI to re-ingest after each deploy.
- **Build minutes:** 750 free build minutes per month.

### Tips

- Set `PINECONE_INDEX_HOST` explicitly to avoid the auto-discovery API call on cold starts
- For production, upgrade to a paid Render instance for persistent disk and no spin-down

## 📄 License

MIT
