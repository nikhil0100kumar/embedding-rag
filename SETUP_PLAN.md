# Gemini Embedding 2 + Pinecone Multimodal RAG Setup Plan

## Goal

Build a single multimodal retrieval pipeline where:

- `gemini-embedding-2-preview` creates embeddings for text, images, and video
- Pinecone stores the shared dense vectors plus searchable metadata
- Groq handles answer generation after retrieval

## Recommended Architecture

Use one Pinecone dense index for all modalities.

Why:

- Gemini Embedding 2 produces embeddings in a shared multimodal space
- one index keeps text-to-image, text-to-video, and cross-modal retrieval simple
- metadata filters can still isolate `text`, `image`, or `video` records

Recommended initial settings:

- metric: `cosine`
- dimension: `1536`
- namespace: `default` for dev, separate namespaces later for tenants or environments

## Phase 1: Data Model

Store vectors in Pinecone, but keep original assets outside Pinecone.

Recommended storage split:

- Pinecone: vector + compact metadata only
- local disk, S3, GCS, or object storage: original files, thumbnails, transcripts

Suggested metadata schema per record:

```json
{
  "id": "video:lesson-42:segment-0007",
  "modality": "video",
  "source_id": "lesson-42",
  "title": "How cosine similarity works",
  "text_preview": "Short searchable summary or transcript snippet",
  "file_uri": "s3://bucket/videos/lesson-42.mp4",
  "thumbnail_uri": "s3://bucket/thumbs/lesson-42-0007.jpg",
  "start_sec": 840,
  "end_sec": 960,
  "language": "en",
  "tags": ["embeddings", "vector-search"],
  "tenant_id": "default"
}
```

Use these common metadata fields across all record types:

- `modality`
- `source_id`
- `title`
- `text_preview`
- `file_uri`
- `tenant_id`
- `tags`
- `created_at`

## Phase 2: Modality-Specific Ingestion

### Text

Pipeline:

1. Extract raw text
2. Chunk semantically, not by fixed character count
3. Add overlap and section metadata
4. Embed each chunk with Gemini
5. Upsert each chunk into Pinecone

Recommended text chunk target:

- 300 to 800 tokens per chunk
- 50 to 100 token overlap

### Images

Pipeline:

1. Load each image
2. Generate one multimodal embedding from the image itself
3. Optionally attach OCR or a short caption in the same request for richer retrieval
4. Upsert into Pinecone with image metadata

Best practice:

- keep one primary image embedding record
- optionally add separate OCR text chunks as additional text records if the image has dense text

### Videos

Pipeline:

1. Split long videos into short overlapping segments
2. For each segment, create a Gemini embedding from the video chunk
3. Also extract transcript chunks and store them as separate text records linked to the same source
4. Upsert both record types into Pinecone

Recommended video strategy:

- segment length: `120` seconds
- overlap: `8` seconds
- keep both:
  - `video` records for visual/audio context
  - `text` transcript records for lexical precision

This dual-indexing pattern usually retrieves better than relying on only raw video embeddings.

## Phase 3: Pinecone Index Setup

Create one dense index with:

- dimension `1536`
- metric `cosine`
- serverless deployment unless you know you need pods

Keep these rules:

- every vector in the index must use the same Gemini embedding model
- do not mix old embedding models with Embedding 2 in the same index
- store only compact metadata because Pinecone metadata is not a document store

## Phase 4: Query Flow

Recommended retrieval flow:

1. User submits a text query
2. Embed the query with Gemini Embedding 2
3. Search Pinecone for top `k`
4. Optionally filter by metadata:
   - `modality == "image"`
   - `modality == "video"`
   - `tenant_id == "..."`
5. Fetch original files or transcript snippets from storage
6. Build a grounded prompt
7. Send context to your generation model via Groq

Future extension:

- support image query -> image/video/text retrieval using the same shared index

## Phase 5: Answer Generation with Groq

Use Groq only after retrieval.

Suggested split of responsibilities:

- Gemini: embeddings
- Pinecone: retrieval
- Groq: synthesis, citations, final answer formatting

Prompt requirements:

- include retrieved snippets and metadata
- cite `source_id`, `title`, timestamps, and file URI where possible
- instruct the model not to invent details missing from retrieved context

## Phase 6: Evaluation

Validate retrieval before building the final chat UX.

Start with a small benchmark set:

- 20 text queries
- 10 image-driven queries
- 10 video-specific queries

For each query, measure:

- relevant item in top 3
- relevant item in top 10
- whether the right modality was returned
- whether transcript-only retrieval beats raw video-only retrieval

## Phase 7: Operational Safeguards

Add these from the start:

- idempotent upserts using stable record IDs
- model version in metadata, for example `embedding_model`
- ingestion logs with file path and source ID
- retry logic for API failures
- dead-letter list for files that fail parsing or embedding

## Build Order

1. Create Pinecone index
2. Build text ingestion first
3. Add image ingestion
4. Add video segmentation + transcript ingestion
5. Add search API
6. Add OpenRouter answer generation
7. Add evaluation set and tune chunking and top-k

## Practical Defaults For This Repo

Current `.env` defaults assume:

- model: `gemini-embedding-2-preview`
- vector dimension: `1536`
- Pinecone metric: `cosine`
- generation model: `openai/gpt-oss-120b` via Groq
- top-k: `10`
- video chunk size: `120s`

## Immediate Next Steps

1. Fill in `.env`
2. Create the Pinecone index with dimension `1536`
3. Decide where raw assets will live
4. Build an ingestion script that outputs:
   - text chunk records
   - image records
   - video segment records
   - transcript text records
5. Test retrieval before building generation
