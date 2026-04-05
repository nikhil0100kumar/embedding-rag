import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-2-preview";
const INGESTION_MODEL = process.env.INGESTION_MODEL || "gemini-2.5-flash";
const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION || 1536);
const EMBEDDING_NORMALIZE = (process.env.EMBEDDING_NORMALIZE || "true") === "true";
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || "multimodal-rag";
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "default";
const PINECONE_INDEX_HOST = process.env.PINECONE_INDEX_HOST || "";
const PINECONE_API_VERSION = process.env.PINECONE_API_VERSION || "2025-10";
const DATA_DIR = path.resolve(process.cwd(), process.env.DATA_DIR || "./data");

let cachedIndexHost = PINECONE_INDEX_HOST;

function assertEnv(name, value) {
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
}

export function ensureIngestionConfig() {
  assertEnv("GEMINI_API_KEY", GEMINI_API_KEY);
  assertEnv("PINECONE_API_KEY", PINECONE_API_KEY);
}

export function getDataDir() {
  return DATA_DIR;
}

function normalizeVector(values) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return values;
  }

  return values.map((value) => value / magnitude);
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function sanitizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function previewText(value, length = 320) {
  const text = sanitizeText(value);
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function parseJsonResponse(rawText) {
  const cleaned = rawText.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned);
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".md": "text/markdown",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain",
    ".webm": "video/webm",
    ".webp": "image/webp"
  };

  return mimeTypes[extension] || "application/octet-stream";
}

export function getModality(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
    return "image";
  }

  if ([".mp4", ".mov", ".m4v", ".avi", ".webm"].includes(extension)) {
    return "video";
  }

  if ([".pdf", ".txt", ".md"].includes(extension)) {
    return "text";
  }

  return "unknown";
}

async function uploadGeminiFile(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const mimeType = getMimeType(filePath);
  const displayName = path.basename(filePath);

  const startResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileBuffer.length),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        file: {
          display_name: displayName
        }
      })
    }
  );

  if (!startResponse.ok) {
    throw new Error(`Gemini upload start failed for ${displayName}: ${startResponse.status} ${await startResponse.text()}`);
  }

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error(`Gemini upload URL missing for ${displayName}`);
  }

  const finalizeResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(fileBuffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: fileBuffer
  });

  if (!finalizeResponse.ok) {
    throw new Error(`Gemini upload finalize failed for ${displayName}: ${finalizeResponse.status} ${await finalizeResponse.text()}`);
  }

  const payload = await finalizeResponse.json();
  return payload.file;
}

async function waitForGeminiFile(fileName) {
  let attempts = 0;
  while (attempts < 30) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`
    );

    if (!response.ok) {
      throw new Error(`Gemini file status failed for ${fileName}: ${response.status} ${await response.text()}`);
    }

    const payload = await response.json();
    const state = payload.state;

    if (state === "ACTIVE") {
      return payload;
    }

    if (state === "FAILED") {
      throw new Error(`Gemini file processing failed for ${fileName}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
    attempts += 1;
  }

  throw new Error(`Timed out waiting for Gemini file ${fileName} to become ACTIVE`);
}

async function deleteGeminiFile(fileName) {
  console.log(`[Ingestion] Deleting Gemini file: ${fileName}`);
  await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_API_KEY}`, {
    method: "DELETE"
  }).catch(() => undefined);
}

async function generateJsonFromFile(file, prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${INGESTION_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                file_data: {
                  mime_type: file.mimeType,
                  file_uri: file.uri
                }
              }
            ]
          }
        ],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini generateContent failed for ${file.displayName}: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();

  if (!text) {
    throw new Error(`Gemini generateContent returned no text for ${file.displayName}`);
  }

  return parseJsonResponse(text);
}

async function embedDocument(text, title) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: {
          parts: [{ text }]
        },
        taskType: "RETRIEVAL_DOCUMENT",
        title,
        outputDimensionality: EMBEDDING_DIMENSION
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini embedContent failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const values = payload?.embedding?.values;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Gemini embedding response did not include vector values");
  }

  return EMBEDDING_NORMALIZE ? normalizeVector(values) : values;
}

async function getPineconeIndexHost() {
  if (cachedIndexHost) {
    return cachedIndexHost;
  }

  const response = await fetch(`https://api.pinecone.io/indexes/${PINECONE_INDEX_NAME}`, {
    headers: {
      "Api-Key": PINECONE_API_KEY,
      "X-Pinecone-Api-Version": PINECONE_API_VERSION
    }
  });

  if (!response.ok) {
    throw new Error(`Pinecone describe index failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  cachedIndexHost = payload.host;

  if (!cachedIndexHost) {
    throw new Error("Pinecone index host was not returned by describe_index");
  }

  return cachedIndexHost;
}

async function upsertVectors(vectors) {
  const host = await getPineconeIndexHost();
  const response = await fetch(`https://${host}/vectors/upsert`, {
    method: "POST",
    headers: {
      "Api-Key": PINECONE_API_KEY,
      "Content-Type": "application/json",
      "X-Pinecone-Api-Version": PINECONE_API_VERSION
    },
    body: JSON.stringify({
      namespace: PINECONE_NAMESPACE,
      vectors
    })
  });

  if (!response.ok) {
    throw new Error(`Pinecone upsert failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ]);

    const parsed = Number(stdout.trim());
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildPdfPrompt() {
  return [
    "You are preparing a PDF for semantic retrieval in a RAG system.",
    "Return strict JSON with this schema:",
    "{",
    '  "title": string,',
    '  "overview": string,',
    '  "chunks": [{"heading": string, "text": string, "keywords": [string]}]',
    "}",
    "CRITICAL instructions for chunking:",
    "- Create between 8 and 40 chunks depending on document length and detail.",
    "- For schedule documents, timetables, or tables: create one chunk per logical group (e.g. per page or per 3-5 rows/matches). Do NOT summarize or skip ANY row.",
    "- Each chunk text MUST reproduce the original data verbatim: match numbers, dates, times, team names, venues, scores, etc.",
    "- Include ALL entries — the first entry, the last entry, and every entry in between. Missing data = retrieval failure.",
    "- For the final section/page of a schedule or table, explicitly label it with keywords like 'last match', 'final match', 'match 70', 'last page' so it can be retrieved by those queries.",
    "- Each chunk text should be detailed enough for retrieval and should include dates, entities, tables, and schedule details if present.",
    "- Prefer more chunks with precise data over fewer chunks with summarized data.",
    "Do not include markdown fences."
  ].join("\n");
}

function buildImagePrompt() {
  return [
    "You are preparing an image for semantic retrieval.",
    "Return strict JSON with this schema:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "ocr_text": string,',
    '  "keywords": [string],',
    '  "entities": [string]',
    "}",
    "Describe the visible scene, objects, actions, style, colors, text in image, and any named entities.",
    "Do not include markdown fences."
  ].join("\n");
}

function buildVideoPrompt() {
  return [
    "You are preparing a short video for semantic retrieval.",
    "Return strict JSON with this schema:",
    "{",
    '  "title": string,',
    '  "summary": string,',
    '  "transcript_like_notes": string,',
    '  "keywords": [string],',
    '  "entities": [string],',
    '  "notable_events": [string]',
    "}",
    "Describe what happens through time, mention visible subjects, actions, settings, and any text/audio cues.",
    "Do not include markdown fences."
  ].join("\n");
}

async function buildRecordsForFile(filePath) {
  const modality = getModality(filePath);
  const basename = path.basename(filePath);
  const relativePath = path.relative(DATA_DIR, filePath).replaceAll("\\", "/");
  const sourceId = slugify(path.basename(filePath, path.extname(filePath)));

  if (modality === "unknown") {
    return [];
  }

  const uploadedFile = await uploadGeminiFile(filePath);

  try {
    const activeFile = await waitForGeminiFile(uploadedFile.name);

    if (modality === "text") {
      const ext = path.extname(filePath).toLowerCase();
      let overview = "";
      let title = basename;
      let retrievalText = "";

      if (ext === ".pdf") {
        console.log(`[Ingestion] Processing PDF via Gemini: ${basename}`);
        const pdfJson = await generateJsonFromFile(activeFile, buildPdfPrompt());
        overview = sanitizeText(pdfJson.overview);
        title = sanitizeText(pdfJson.title) || basename;
        const chunks = Array.isArray(pdfJson.chunks) ? pdfJson.chunks : [];

        const records = [];
        for (const [index, chunk] of chunks.entries()) {
          const heading = sanitizeText(chunk.heading) || `Chunk ${index + 1}`;
          const chunkText = sanitizeText(chunk.text);
          const keywords = Array.isArray(chunk.keywords) ? chunk.keywords.map(sanitizeText).filter(Boolean) : [];

          if (!chunkText) continue;

          retrievalText = [
            `Document title: ${title}`,
            `Document overview: ${overview}`,
            `Section heading: ${heading}`,
            `Keywords: ${keywords.join(", ")}`,
            `Section content: ${chunkText}`
          ].filter(Boolean).join("\n");

          console.log(`[Ingestion] Embedding chunk ${index + 1} of ${chunks.length} for ${basename}`);
          const values = await embedDocument(retrievalText, `${title} - ${heading}`);
          records.push({
            id: `pdf:${sourceId}:${String(index + 1).padStart(3, "0")}`,
            values,
            metadata: {
              modality: "text",
              source_id: sourceId,
              title,
              section_heading: heading,
              text_preview: previewText(chunkText),
              text: retrievalText,
              file_uri: `/data/${relativePath}`,
              filename: basename,
              embedding_model: EMBEDDING_MODEL,
              origin_type: "pdf",
              keywords,
              created_at: new Date().toISOString()
            }
          });
        }
        return records;
      } else {
        // Plain text or Markdown
        console.log(`[Ingestion] Processing text/md file: ${basename}`);
        const content = await fs.readFile(filePath, "utf8");
        const cleanContent = sanitizeText(content);

        if (!cleanContent) {
          console.log(`[Ingestion] Skipping empty text file: ${basename}`);
          return [];
        }

        retrievalText = `Document title: ${title}\n\nContent: ${cleanContent}`;
        console.log(`[Ingestion] Embedding text content for ${basename}`);
        const values = await embedDocument(retrievalText, title);

        return [{
          id: `text:${sourceId}`,
          values,
          metadata: {
            modality: "text",
            source_id: sourceId,
            title,
            text_preview: previewText(cleanContent),
            text: retrievalText,
            file_uri: `/data/${relativePath}`,
            filename: basename,
            embedding_model: EMBEDDING_MODEL,
            origin_type: ext.replace(".", "") || "text",
            created_at: new Date().toISOString()
          }
        }];
      }
    }

    if (modality === "image") {
      console.log(`[Ingestion] Processing image via Gemini: ${basename}`);
      const imageJson = await generateJsonFromFile(activeFile, buildImagePrompt());
      const title = sanitizeText(imageJson.title) || basename;
      const summary = sanitizeText(imageJson.summary);
      const ocrText = sanitizeText(imageJson.ocr_text);
      const keywords = Array.isArray(imageJson.keywords) ? imageJson.keywords.map(sanitizeText).filter(Boolean) : [];
      const entities = Array.isArray(imageJson.entities) ? imageJson.entities.map(sanitizeText).filter(Boolean) : [];
      const retrievalText = [
        `Image title: ${title}`,
        `Summary: ${summary}`,
        ocrText ? `OCR text: ${ocrText}` : "",
        keywords.length ? `Keywords: ${keywords.join(", ")}` : "",
        entities.length ? `Entities: ${entities.join(", ")}` : ""
      ].filter(Boolean).join("\n");

      const values = await embedDocument(retrievalText, title);
      return [{
        id: `image:${sourceId}`,
        values,
        metadata: {
          modality: "image",
          source_id: sourceId,
          title,
          text_preview: previewText(summary || retrievalText),
          text: retrievalText,
          file_uri: `/data/${relativePath}`,
          filename: basename,
          embedding_model: EMBEDDING_MODEL,
          origin_type: "image",
          keywords,
          entities,
          created_at: new Date().toISOString()
        }
      }];
    }

    if (modality === "video") {
      console.log(`[Ingestion] Processing video via Gemini: ${basename}`);
      const videoJson = await generateJsonFromFile(activeFile, buildVideoPrompt());
      const title = sanitizeText(videoJson.title) || basename;
      const summary = sanitizeText(videoJson.summary);
      const transcriptLikeNotes = sanitizeText(videoJson.transcript_like_notes);
      const keywords = Array.isArray(videoJson.keywords) ? videoJson.keywords.map(sanitizeText).filter(Boolean) : [];
      const entities = Array.isArray(videoJson.entities) ? videoJson.entities.map(sanitizeText).filter(Boolean) : [];
      const events = Array.isArray(videoJson.notable_events) ? videoJson.notable_events.map(sanitizeText).filter(Boolean) : [];
      const durationSec = await getVideoDuration(filePath);
      const retrievalText = [
        `Video title: ${title}`,
        `Summary: ${summary}`,
        transcriptLikeNotes ? `Transcript-like notes: ${transcriptLikeNotes}` : "",
        keywords.length ? `Keywords: ${keywords.join(", ")}` : "",
        entities.length ? `Entities: ${entities.join(", ")}` : "",
        events.length ? `Notable events: ${events.join(" | ")}` : ""
      ].filter(Boolean).join("\n");

      const values = await embedDocument(retrievalText, title);
      return [{
        id: `video:${sourceId}`,
        values,
        metadata: {
          modality: "video",
          source_id: sourceId,
          title,
          text_preview: previewText(summary || transcriptLikeNotes || retrievalText),
          text: retrievalText,
          file_uri: `/data/${relativePath}`,
          filename: basename,
          embedding_model: EMBEDDING_MODEL,
          origin_type: "video",
          duration_sec: durationSec,
          keywords,
          entities,
          created_at: new Date().toISOString()
        }
      }];
    }

    return [];
  } finally {
    await deleteGeminiFile(uploadedFile.name);
  }
}

export async function ingestFilePaths(filePaths, onProgress) {
  ensureIngestionConfig();
  await fs.mkdir(DATA_DIR, { recursive: true });

  const report = {
    startedAt: new Date().toISOString(),
    dataDir: DATA_DIR,
    files: [],
    vectorsUpserted: 0
  };

  const totalFiles = filePaths.length;
  for (let i = 0; i < totalFiles; i++) {
    const filePath = filePaths[i];
    const modality = getModality(filePath);
    const displayName = path.basename(filePath);

    if (onProgress) {
      onProgress({ type: "file_start", file: displayName, index: i, total: totalFiles });
    }

    try {
      console.log(`[Ingestion] Starting ingestion for: ${displayName} (${modality})`);
      const vectors = await buildRecordsForFile(filePath);

      if (vectors.length === 0) {
        console.log(`[Ingestion] No vectors generated for: ${displayName}`);
        report.files.push({ file: displayName, modality, status: "skipped", vectors: 0 });
      } else {
        console.log(`[Ingestion] Upserting ${vectors.length} vectors to Pinecone for: ${displayName}`);
        await upsertVectors(vectors);
        console.log(`[Ingestion] Successfully upserted: ${displayName}`);
        report.files.push({ file: displayName, modality, status: "upserted", vectors: vectors.length });
        report.vectorsUpserted += vectors.length;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Ingestion] Failed to ingest ${displayName}:`, message);
      report.files.push({ file: displayName, modality, status: "failed", error: message });
    }

    if (onProgress) {
      onProgress({
        type: "file_end",
        file: displayName,
        index: i,
        total: totalFiles,
        status: report.files[report.files.length - 1]?.status || "unknown"
      });
    }
  }

  report.finishedAt = new Date().toISOString();
  return report;
}
