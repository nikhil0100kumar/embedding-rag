import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Busboy from "busboy";
import { getDataDir, getModality, ingestFilePaths } from "./ingestion-core.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const dataDir = getDataDir();

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-2-preview";
const EMBEDDING_DIMENSION = Number(process.env.EMBEDDING_DIMENSION || 1536);
const EMBEDDING_NORMALIZE = (process.env.EMBEDDING_NORMALIZE || "true") === "true";
const PINECONE_INDEX_NAME = process.env.PINECONE_INDEX_NAME || "multimodal-rag";
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "default";
const PINECONE_API_VERSION = process.env.PINECONE_API_VERSION || "2025-10";
const GENERATION_MODEL = process.env.GENERATION_MODEL || "openai/gpt-oss-120b";
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
const DEFAULT_TOP_K = Number(process.env.TOP_K || 10);
const MAX_SNIPPET_CHARS = Number(process.env.MAX_SNIPPET_CHARS || 800);
const PINECONE_INDEX_HOST = process.env.PINECONE_INDEX_HOST || "";
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || "*";

let cachedIndexHost = PINECONE_INDEX_HOST;

function resolveCorsOrigin(requestOrigin) {
  if (CORS_ALLOW_ORIGIN === "*") {
    return "*";
  }

  const allowList = CORS_ALLOW_ORIGIN
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (requestOrigin && allowList.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowList[0] || "http://localhost";
}

function buildCorsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": resolveCorsOrigin(request.headers.origin),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin"
  };
}

function json(request, response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendFile(request, response, filePath, contentType) {
  return readFile(filePath)
    .then((content) => {
      response.writeHead(200, {
        ...buildCorsHeaders(request),
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      });
      response.end(content);
    })
    .catch(() => {
      json(request, response, 404, { error: "Not found" });
    });
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".md": "text/markdown",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".txt": "text/plain; charset=utf-8",
    ".webm": "video/webm",
    ".webp": "image/webp"
  };

  return contentTypes[extension] || "application/octet-stream";
}

function sanitizeFilename(filename) {
  const extension = path.extname(filename);
  const basename = path.basename(filename, extension)
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80) || "upload";

  return `${basename}${extension.toLowerCase()}`;
}

function uniqueFilePath(filename) {
  const safeName = sanitizeFilename(filename);
  return path.join(dataDir, `${Date.now()}-${safeName}`);
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(rawBody);
}

async function parseMultipartUploads(request) {
  await mkdir(dataDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: request.headers });
    const filePaths = [];
    const writes = [];

    console.log(`[Busboy] Starting multipart parse...`);

    busboy.on("file", (fieldname, file, info) => {
      const { filename, encoding, mimeType } = info || {};
      console.log(`[Busboy] File event: field=${fieldname}, name=${filename}, type=${mimeType}`);

      if (!filename) {
        console.warn("[Busboy] Skipping file with no filename.");
        file.resume();
        return;
      }

      const destination = uniqueFilePath(filename);
      const writeStream = createWriteStream(destination);
      file.pipe(writeStream);
      filePaths.push(destination);

      writes.push(new Promise((writeResolve, writeReject) => {
        writeStream.on("finish", () => {
          console.log(`[Busboy] Finished writing: ${filename}`);
          writeResolve();
        });
        writeStream.on("error", (err) => {
          console.error(`[Busboy] Write error for ${filename}:`, err);
          writeReject(err);
        });
        file.on("error", writeReject);
      }));
    });

    busboy.on("error", (err) => {
      console.error("[Busboy] Parser error:", err);
      reject(err);
    });

    busboy.on("finish", async () => {
      console.log(`[Busboy] Parse complete. Total files: ${filePaths.length}`);
      try {
        await Promise.all(writes);
        resolve(filePaths);
      } catch (error) {
        reject(error);
      }
    });

    request.pipe(busboy);
  });
}

async function listAssets() {
  await mkdir(dataDir, { recursive: true });
  const entries = await readdir(dataDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const relativePath = entry.name.replaceAll("\\", "/");
      return {
        filename: entry.name,
        modality: getModality(entry.name),
        fileUri: `/data/${relativePath}`
      };
    })
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

function normalizeVector(values) {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return values;
  }

  return values.map((value) => value / magnitude);
}

function inferModality(questionText, selectedModality) {
  if (selectedModality && selectedModality !== "all") {
    return selectedModality;
  }

  const text = questionText.toLowerCase();

  if (/\b(video|videos|clip|clips|watch|play|movie|movies|footage|reel|reels)\b/.test(text)) {
    return "video";
  }

  if (/\b(image|images|photo|photos|picture|pictures|pic|pics|show me|show)\b/.test(text)) {
    return "image";
  }

  if (/\b(pdf|document|documents|doc|docs|text|report|schedule|page|pages|file)\b/.test(text)) {
    return "text";
  }

  return "all";
}

function inferIntent(questionText) {
  const text = questionText.toLowerCase();

  if (/\b(is there|are there|do you have|any)\b/.test(text)) {
    return "availability";
  }

  if (/\b(show|open|play|watch|display)\b/.test(text)) {
    return "direct_media";
  }

  return "general";
}

async function embedQuery(text) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY");
  }

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
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: EMBEDDING_DIMENSION
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini embedding failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const values = payload?.embedding?.values;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Gemini embedding response did not include vector values.");
  }

  return EMBEDDING_NORMALIZE ? normalizeVector(values) : values;
}

async function getPineconeIndexHost() {
  if (cachedIndexHost) {
    return cachedIndexHost;
  }

  if (!PINECONE_API_KEY) {
    throw new Error("Missing PINECONE_API_KEY");
  }

  const response = await fetch(`https://api.pinecone.io/indexes/${PINECONE_INDEX_NAME}`, {
    headers: {
      "Api-Key": PINECONE_API_KEY,
      "X-Pinecone-Api-Version": PINECONE_API_VERSION
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinecone describe index failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  cachedIndexHost = payload.host;

  if (!cachedIndexHost) {
    throw new Error("Pinecone index host was not returned by describe_index.");
  }

  return cachedIndexHost;
}

async function queryPinecone(vector, topK, modality) {
  const host = await getPineconeIndexHost();
  const filter = modality && modality !== "all"
    ? { modality: { $eq: modality } }
    : undefined;

  const response = await fetch(`https://${host}/query`, {
    method: "POST",
    headers: {
      "Api-Key": PINECONE_API_KEY,
      "Content-Type": "application/json",
      "X-Pinecone-Api-Version": PINECONE_API_VERSION
    },
    body: JSON.stringify({
      namespace: PINECONE_NAMESPACE,
      vector,
      topK,
      includeMetadata: true,
      ...(filter ? { filter } : {})
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pinecone query failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

function truncateSnippet(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

function extractContent(fullText) {
  // The ingestion stores text as:
  //   Document title: ...\nDocument overview: ...\nSection heading: ...\nKeywords: ...\nSection content: ...
  // Strip the redundant prefix to save tokens — title/heading are sent separately.
  const contentMarker = fullText.indexOf('Section content:');
  if (contentMarker !== -1) {
    return fullText.slice(contentMarker + 'Section content:'.length).trim();
  }
  const contentMarker2 = fullText.indexOf('Content:');
  if (contentMarker2 !== -1) {
    return fullText.slice(contentMarker2 + 'Content:'.length).trim();
  }
  return fullText;
}

function buildContext(matches) {
  return matches.map((match, index) => {
    const metadata = match.metadata || {};
    const rawText =
      metadata.text ||
      metadata.text_preview ||
      metadata.snippet ||
      metadata.summary ||
      metadata.description ||
      "No text preview was stored for this record.";

    // Extract just the content portion, skip redundant title/overview/keywords prefix
    const content = extractContent(rawText);
    const snippet = truncateSnippet(content, MAX_SNIPPET_CHARS);

    return [
      `Source ${index + 1}`,
      `id: ${match.id}`,
      `score: ${typeof match.score === "number" ? match.score.toFixed(4) : "n/a"}`,
      `modality: ${metadata.modality || "unknown"}`,
      `title: ${metadata.title || metadata.source_id || "Untitled source"}`,
      metadata.section_heading ? `section: ${metadata.section_heading}` : null,
      metadata.file_uri ? `file_uri: ${metadata.file_uri}` : null,
      metadata.start_sec !== undefined ? `start_sec: ${metadata.start_sec}` : null,
      metadata.end_sec !== undefined ? `end_sec: ${metadata.end_sec}` : null,
      `content: ${snippet}`
    ]
      .filter(Boolean)
      .join("\n");
  }).join("\n\n");
}

function extractCitedSourceRanks(answer) {
  return new Set(
    [...String(answer || "").matchAll(/(?:\[|【|\()?Source\s*(\d+)(?:\]|】|\))?/gi)]
      .map((match) => Number(match[1]))
      .filter(Number.isFinite)
  );
}

function prepareConversation(history, question) {
  const safeHistory = Array.isArray(history)
    ? history
      .filter((item) => item && typeof item.role === "string" && typeof item.content === "string")
      .slice(-8)
      .map((item) => ({
        role: item.role === "assistant" ? "assistant" : "user",
        content: item.content
      }))
    : [];

  return [
    {
      role: "system",
      content: [
        "You are a helpful RAG assistant that answers questions using retrieved context.",
        "Rules for your responses:",
        "1. Answer ONLY from the provided retrieval context. If the info is not there, say so politely.",
        "2. Do NOT include source citations like [Source 1] or 【Source 1】 in your answer. The UI shows source cards automatically.",
        "3. Do NOT use any markdown formatting — no **, no ##, no -, no bullet lists, no bold, no italic. Write in plain conversational sentences.",
        "4. Be specific: include exact dates, times, team names, and venues when the context has them.",
        "5. Keep answers concise — 1 to 3 short sentences for simple questions.",
        "6. For schedule queries, list matches naturally like: 'CSK vs RCB is on 18 May 2026 at 7:30 PM in Chennai.'",
        "7. Do not repeat raw file paths or vector IDs."
      ].join(" ")
    },
    ...safeHistory,
    {
      role: "user",
      content: [
        "Use the retrieved context below to answer the latest question.",
        `Resolved modality: ${question.resolvedModality}`,
        `Detected intent: ${question.intent}`,
        question.intent === "availability"
          ? "Answer style: concise. Say whether matching media exists, how many relevant items were found, and list only the titles."
          : question.intent === "direct_media"
            ? "Answer style: concise. Acknowledge the requested media and tell the user it is shown below in the source cards."
            : "Answer style: concise and grounded.",
        "",
        "Retrieved context:",
        buildContext(question.matches),
        "",
        `Latest question: ${question.text}`
      ].join("\n")
    }
  ];
}

async function generateAnswer(questionText, history, matches, resolvedModality, intent) {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY");
  }

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: GENERATION_MODEL,
      temperature: 0.2,
      max_completion_tokens: 900,
      messages: prepareConversation(history, {
        text: questionText,
        matches,
        resolvedModality,
        intent
      })
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq generation failed: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Groq response did not include assistant content.");
  }

  return content;
}

function mapSources(matches) {
  return matches.map((match, index) => ({
    rank: match.originalRank || index + 1,
    id: match.id,
    score: match.score,
    metadata: match.metadata || {}
  }));
}

async function handleHealth(request, response) {
  let pineconeHost = cachedIndexHost || null;
  let pineconeStatus = "ready";

  try {
    pineconeHost = await getPineconeIndexHost();
  } catch (error) {
    pineconeStatus = error.message;
  }

  json(request, response, 200, {
    ok: true,
    services: {
      gemini: Boolean(GEMINI_API_KEY),
      pinecone: Boolean(PINECONE_API_KEY),
      groq: Boolean(GROQ_API_KEY)
    },
    pinecone: {
      indexName: PINECONE_INDEX_NAME,
      namespace: PINECONE_NAMESPACE,
      host: pineconeHost,
      status: pineconeStatus
    },
    embedding: {
      model: EMBEDDING_MODEL,
      dimension: EMBEDDING_DIMENSION,
      normalize: EMBEDDING_NORMALIZE
    },
    generation: {
      model: GENERATION_MODEL
    }
  });
}

async function handleAssets(request, response) {
  try {
    const assets = await listAssets();
    return json(request, response, 200, {
      assets,
      counts: assets.reduce((accumulator, asset) => {
        accumulator.total += 1;
        accumulator[asset.modality] = (accumulator[asset.modality] || 0) + 1;
        return accumulator;
      }, { total: 0, text: 0, image: 0, video: 0, unknown: 0 })
    });
  } catch (error) {
    return json(request, response, 500, {
      error: error instanceof Error ? error.message : "Failed to list assets."
    });
  }
}

async function handleUpload(request, response) {
  try {
    console.log(`[Server] Received upload request: ${request.headers["content-type"]}`);

    const UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || "Kumar@9581341643";
    const reqPassword = request.headers["x-upload-password"];

    if (UPLOAD_PASSWORD && reqPassword !== UPLOAD_PASSWORD) {
      console.warn("[Server] Unauthorized upload attempt. Invalid password.");
      return json(request, response, 401, { error: "Unauthorized: Invalid upload password." });
    }

    const filePaths = await parseMultipartUploads(request);

    if (filePaths.length === 0) {
      console.warn("[Server] No files found in upload request.");
      return json(request, response, 400, { error: "No files were uploaded." });
    }

    console.log(`[Server] Files saved locally, starting ingestion for ${filePaths.length} files...`);

    // Use NDJSON streaming for real-time progress
    response.writeHead(200, {
      ...buildCorsHeaders(request),
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    });

    const report = await ingestFilePaths(filePaths, (progress) => {
      response.write(JSON.stringify({ kind: "progress", ...progress }) + "\n");
    });

    const successCount = report.files.filter(f => f.status === "upserted").length;
    console.log(`[Server] Ingestion finished. Success: ${successCount}, Failed: ${report.files.length - successCount}`);

    response.write(JSON.stringify({ kind: "report", ...report }) + "\n");
    response.end();
  } catch (error) {
    console.error("[Server] Upload/Ingestion handler failed:", error);
    if (!response.headersSent) {
      return json(request, response, 500, {
        error: error instanceof Error ? error.message : "Upload failed."
      });
    } else {
      response.write(JSON.stringify({ kind: "error", error: error.message }) + "\n");
      response.end();
    }
  }
}

async function handleChat(request, response) {
  const body = await readRequestBody(request);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  const history = Array.isArray(body.history) ? body.history : [];
  const modality = typeof body.modality === "string" ? body.modality : "all";
  const topK = Number(body.topK || DEFAULT_TOP_K);

  if (!message) {
    return json(request, response, 400, { error: "Message is required." });
  }

  try {
    const resolvedModality = inferModality(message, modality);
    const intent = inferIntent(message);
    const queryVector = await embedQuery(message);
    const pineconeResult = await queryPinecone(queryVector, topK, resolvedModality);
    const matches = Array.isArray(pineconeResult.matches) ? pineconeResult.matches : [];
    matches.forEach((m, idx) => { m.originalRank = idx + 1; });

    if (matches.length === 0) {
      return json(request, response, 200, {
        answer: "I couldn't find any matching context in Pinecone for that question yet.",
        sources: [],
        resolvedModality,
        usage: { readUnits: pineconeResult?.usage?.read_units || null }
      });
    }

    const answer = await generateAnswer(message, history, matches, resolvedModality, intent);

    // Always send top unique sources — the LLM no longer cites [Source N]
    const uniqueVisibleMatches = [];
    const seenUris = new Set();
    for (const match of matches) {
      const uri = match.metadata?.file_uri || match.id;
      if (!seenUris.has(uri)) {
        seenUris.add(uri);
        uniqueVisibleMatches.push(match);
      }
      if (uniqueVisibleMatches.length >= 3) break;
    }

    return json(request, response, 200, {
      answer,
      sources: mapSources(uniqueVisibleMatches),
      intent,
      resolvedModality,
      usage: { readUnits: pineconeResult?.usage?.read_units || null }
    });
  } catch (error) {
    return json(request, response, 500, {
      error: error instanceof Error ? error.message : "Unknown server error."
    });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, buildCorsHeaders(request));
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return handleHealth(request, response);
  }

  if (request.method === "GET" && url.pathname === "/api/assets") {
    return handleAssets(request, response);
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    return handleChat(request, response);
  }

  if (request.method === "POST" && url.pathname === "/api/upload") {
    return handleUpload(request, response);
  }

  if (request.method === "GET" && url.pathname === "/") {
    return sendFile(request, response, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
  }

  if (request.method === "GET" && url.pathname === "/runtime-config.js") {
    return sendFile(
      request,
      response,
      path.join(publicDir, "runtime-config.js"),
      "text/javascript; charset=utf-8"
    );
  }

  if (request.method === "GET" && url.pathname === "/app.js") {
    return sendFile(request, response, path.join(publicDir, "app.js"), "text/javascript; charset=utf-8");
  }

  if (request.method === "GET" && url.pathname === "/styles.css") {
    return sendFile(request, response, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
  }

  if (request.method === "GET" && url.pathname.startsWith("/data/")) {
    const relativePath = decodeURIComponent(url.pathname.replace(/^\/data\//, ""));
    const resolvedPath = path.resolve(dataDir, relativePath);

    if (!resolvedPath.startsWith(dataDir)) {
      return json(request, response, 403, { error: "Forbidden" });
    }

    return sendFile(request, response, resolvedPath, getContentType(resolvedPath));
  }

  return json(request, response, 404, { error: "Not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`RAG chat server running at http://0.0.0.0:${PORT}`);
});
