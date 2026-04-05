const apiBaseUrl = String(window.APP_CONFIG?.apiBaseUrl || "").replace(/\/$/, "");

const state = {
  selectedFiles: [],
  assets: [],
  counts: { total: 0, text: 0, image: 0, video: 0 },
  history: []
};

const refs = {
  assetBadge: document.querySelector("#assetBadge"),
  assetList: document.querySelector("#assetList"),
  chatModality: document.querySelector("#chatModality"),
  chatTopK: document.querySelector("#chatTopK"),
  composer: document.querySelector("#composer"),
  fileInput: document.querySelector("#fileInput"),
  globalSearch: document.querySelector("#globalSearch"),
  imageCount: document.querySelector("#imageCount"),
  importTrigger: document.querySelector("#importTrigger"),
  librarySummary: document.querySelector("#librarySummary"),
  messageInput: document.querySelector("#messageInput"),
  messageTemplate: document.querySelector("#messageTemplate"),
  messages: document.querySelector("#messages"),
  navItems: [...document.querySelectorAll(".nav-item")],
  promptChips: [...document.querySelectorAll(".prompt-chip")],
  refreshLibrary: document.querySelector("#refreshLibrary"),
  selectedCount: document.querySelector("#selectedCount"),
  selectedFiles: document.querySelector("#selectedFiles"),
  sendButton: document.querySelector("#sendButton"),
  statusCards: document.querySelector("#statusCards"),
  statusClose: document.querySelector("#statusClose"),
  statusSheet: document.querySelector("#statusSheet"),
  statusToggle: document.querySelector("#statusToggle"),
  goToChat: document.querySelector("#goToChat"),
  backToUpload: document.querySelector("#backToUpload"),
  switchToChat: document.querySelector("#switchToChat"),
  textCount: document.querySelector("#textCount"),
  totalCount: document.querySelector("#totalCount"),
  uploadScreen: document.querySelector("#uploadScreen"),
  chatScreen: document.querySelector("#chatScreen"),
  uploadStatus: document.querySelector("#uploadStatus"),
  uploadTrigger: document.querySelector("#uploadTrigger"),
  videoCount: document.querySelector("#videoCount"),
  uploadDropArea: document.querySelector("#uploadDropArea")
};

function endpoint(pathname) {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return apiBaseUrl ? `${apiBaseUrl}${normalized}` : normalized;
}

function resolveAssetUrl(fileUri) {
  if (!fileUri) {
    return "";
  }

  if (/^(https?:)?\/\//i.test(fileUri)) {
    return fileUri;
  }

  return endpoint(fileUri);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inferModality(name = "") {
  const lower = name.toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif)$/i.test(lower)) {
    return "image";
  }
  if (/\.(mp4|mov|webm|m4v)$/i.test(lower)) {
    return "video";
  }
  return "text";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function parseSourceReferences(content) {
  const matches = [...String(content || "").matchAll(/(?:\[|【|\()?Source\s*(\d+)(?:\]|】|\))?/gi)];
  return new Set(matches.map((match) => Number(match[1])).filter(Number.isFinite));
}

function getSourceType(metadata = {}) {
  const fileUri = String(metadata.file_uri || "").toLowerCase();
  const originType = String(metadata.origin_type || "").toLowerCase();
  const modality = String(metadata.modality || "").toLowerCase();

  if (originType === "image" || modality === "image" || /\.(jpg|jpeg|png|webp|gif)$/i.test(fileUri)) {
    return "image";
  }

  if (originType === "video" || modality === "video" || /\.(mp4|webm|mov|m4v)$/i.test(fileUri)) {
    return "video";
  }

  if (originType === "pdf" || /\.pdf(?:#.*)?$/i.test(fileUri)) {
    return "pdf";
  }

  return "text";
}

function renderMediaPreview(metadata = {}) {
  const fileUri = metadata.file_uri;
  if (!fileUri) {
    return "";
  }

  const safeUri = escapeHtml(resolveAssetUrl(fileUri));
  const title = escapeHtml(metadata.title || metadata.source_id || "Retrieved asset");
  const sourceType = getSourceType(metadata);

  if (sourceType === "image") {
    return `
      <figure class="media-preview image-preview">
        <img src="${safeUri}" alt="${title}" loading="lazy" />
      </figure>
    `;
  }

  if (sourceType === "video") {
    return `
      <figure class="media-preview video-preview">
        <video controls preload="metadata" playsinline>
          <source src="${safeUri}" />
          Your browser could not play this video.
        </video>
      </figure>
    `;
  }

  if (sourceType === "pdf") {
    return `
      <figure class="media-preview pdf-preview">
        <iframe src="${safeUri}#view=FitH" title="${title}"></iframe>
      </figure>
    `;
  }

  return "";
}

function buildSourceMarkup(source) {
  const metadata = source.metadata || {};
  const title = escapeHtml(metadata.title || metadata.source_id || source.id);
  const preview = escapeHtml(
    metadata.text_preview ||
    metadata.text ||
    metadata.snippet ||
    metadata.summary ||
    metadata.description ||
    "No preview stored"
  );
  const modality = escapeHtml(metadata.modality || "unknown");
  const score = Number(source.score || 0).toFixed(3);
  const fileUri = metadata.file_uri ? escapeHtml(resolveAssetUrl(metadata.file_uri)) : "";
  const mediaPreview = renderMediaPreview(metadata);
  const sourceType = getSourceType(metadata);
  const ctaLabel =
    sourceType === "image"
      ? "Open image"
      : sourceType === "video"
        ? "Open video"
        : sourceType === "pdf"
          ? "Open document"
          : "Open asset";

  return `
    <section class="source-card">
      <div class="source-card-head">
        <strong>[Source ${escapeHtml(String(source.rank))}] ${title}</strong>
        <span>${modality} � score ${score}</span>
      </div>
      ${mediaPreview}
      <p>${preview}</p>
      ${fileUri ? `<a class="asset-link" href="${fileUri}" target="_blank" rel="noreferrer">${ctaLabel}</a>` : ""}
    </section>
  `;
}

let screenTransitioning = false;

function setActiveScreen(screenName) {
  const currentScreen = document.querySelector(".screen.active");
  const nextScreen = screenName === "upload" ? refs.uploadScreen : refs.chatScreen;

  if (currentScreen === nextScreen || screenTransitioning) {
    return;
  }

  screenTransitioning = true;

  if (currentScreen) {
    currentScreen.classList.remove("active");
    currentScreen.classList.add("leaving");
    setTimeout(() => {
      currentScreen.classList.remove("leaving");
    }, 400); // Increased to match CSS duration
  }

  nextScreen.classList.add("entering");
  nextScreen.classList.add("active");

  setTimeout(() => {
    nextScreen.classList.remove("entering");
    screenTransitioning = false;
  }, 50);

  for (const item of refs.navItems) {
    item.classList.toggle("active", item.dataset.screen === screenName);
  }
}

function setUploadStatus(title, body, stateName = "info") {
  refs.uploadStatus.classList.add("visible");
  refs.uploadStatus.dataset.state = stateName;
  refs.uploadStatus.innerHTML = `
    <div class="status-illustration">${stateName === "success" ? "OK" : stateName === "error" ? "ER" : "UP"}</div>
    <strong>${escapeHtml(title)}</strong>
    <p>${escapeHtml(body)}</p>
  `;
}

function updateCountLabels() {
  const counts = state.counts;
  if (refs.assetBadge) refs.assetBadge.textContent = `${counts.total || 0} indexed`;
  if (refs.librarySummary) refs.librarySummary.textContent = `${counts.total || 0} assets`;
  if (refs.totalCount) refs.totalCount.textContent = String(counts.total || 0);
  if (refs.selectedCount) refs.selectedCount.textContent = String(state.selectedFiles.length);
  if (refs.imageCount) refs.imageCount.textContent = String(counts.image || 0);
  if (refs.videoCount) refs.videoCount.textContent = String(counts.video || 0);
}

function updateUploadButton() {
  const count = state.selectedFiles.length;
  refs.uploadTrigger.style.display = count > 0 ? "flex" : "none";
  refs.uploadTrigger.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;">
      <line x1="22" y1="2" x2="11" y2="13"></line>
      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>
    Ingest ${count} File${count === 1 ? "" : "s"}
  `;
}

function renderSelectedFiles() {
  if (state.selectedFiles.length === 0) {
    refs.selectedFiles.className = "selection-list empty-list";
    refs.selectedFiles.textContent = "No files selected yet.";
    updateCountLabels();
    updateUploadButton();
    return;
  }

  refs.selectedFiles.className = "selection-list";
  refs.selectedFiles.innerHTML = state.selectedFiles
    .map((file, index) => {
      const modality = inferModality(file.name);
      return `
        <div class="selection-row">
          <div class="selection-info">
            <strong>${escapeHtml(file.name)}</strong>
            <div class="selection-meta">${escapeHtml(modality)} � ${formatBytes(file.size)}</div>
          </div>
          <button class="selection-remove" data-remove-index="${index}" type="button">x</button>
        </div>
      `;
    })
    .join("");

  updateCountLabels();
  updateUploadButton();
}

function renderAssets() {
  const searchTerm = refs.globalSearch.value.trim().toLowerCase();
  const filteredAssets = state.assets.filter((asset) => {
    if (!searchTerm) {
      return true;
    }

    return `${asset.filename} ${asset.modality}`.toLowerCase().includes(searchTerm);
  });

  if (filteredAssets.length === 0) {
    refs.assetList.innerHTML = `
      <div class="empty-card">
        <div class="empty-illustration">SR</div>
        <div>No matching assets found.</div>
      </div>
    `;
    return;
  }

  refs.assetList.innerHTML = filteredAssets
    .map((asset) => {
      const url = escapeHtml(resolveAssetUrl(asset.fileUri));
      return `
        <article class="asset-row">
          <div class="asset-info">
            <strong>${escapeHtml(asset.filename)}</strong>
            <div class="asset-meta">Stored locally and available for Pinecone-backed retrieval.</div>
          </div>
          <div class="asset-side">
            <span class="asset-tag">${escapeHtml(asset.modality)}</span>
            <a class="asset-link" href="${url}" target="_blank" rel="noreferrer">Open</a>
          </div>
        </article>
      `;
    })
    .join("");
}

function addMessage(role, content, sources = []) {
  const fragment = refs.messageTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".message-card");
  const meta = fragment.querySelector(".message-meta");
  const body = fragment.querySelector(".message-body");
  const sourcesContainer = fragment.querySelector(".sources");

  article.classList.add(role);
  meta.textContent = role === "assistant" ? "RAG assistant" : "You";
  body.textContent = content;

  if (Array.isArray(sources) && sources.length > 0) {
    sourcesContainer.innerHTML = sources.map(buildSourceMarkup).join("");
  }

  refs.messages.appendChild(fragment);
  refs.messages.scrollTop = refs.messages.scrollHeight;
}

function setBusy(isBusy) {
  refs.sendButton.disabled = isBusy;
  refs.messageInput.disabled = isBusy;
  if (isBusy) {
    refs.sendButton.classList.add("busy");
    refs.sendButton.innerHTML = `<span class="send-spinner"></span>`;
  } else {
    refs.sendButton.classList.remove("busy");
    refs.sendButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"></line>
        <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
      </svg>`;
  }
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(endpoint(pathname), options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}.`);
  }

  return payload;
}

async function loadAssets() {
  try {
    const payload = await fetchJson("/api/assets");
    state.assets = Array.isArray(payload.assets) ? payload.assets : [];
    state.counts = payload.counts || { total: 0, text: 0, image: 0, video: 0 };
    updateCountLabels();
    renderAssets();
  } catch (error) {
    renderAssets();
    setUploadStatus("Could not refresh assets", error.message, "error");
  }
}

async function loadStatus() {
  refs.statusCards.innerHTML = '<p class="status-loading">Checking services...</p>';

  try {
    const payload = await fetchJson("/api/health");
    const cards = [
      ["Gemini", payload.services.gemini ? "Configured" : "Missing key", payload.embedding.model],
      ["Pinecone", payload.services.pinecone ? "Configured" : "Missing key", payload.pinecone.host || payload.pinecone.status],
      ["Groq", payload.services.groq ? "Configured" : "Missing key", payload.generation.model],
      ["API Base", apiBaseUrl || "Same origin", payload.pinecone.indexName]
    ];

    refs.statusCards.innerHTML = cards
      .map(
        ([label, value, detail]) => `
          <div class="status-card">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <small>${escapeHtml(detail || "")}</small>
          </div>
        `
      )
      .join("");
  } catch (error) {
    refs.statusCards.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

async function uploadSelectedFiles() {
  if (state.selectedFiles.length === 0) {
    setUploadStatus("No files selected", "Choose files first, then upload them to embed and store them in Pinecone.", "error");
    return;
  }

  const formData = new FormData();
  for (const file of state.selectedFiles) {
    formData.append("files", file, file.name);
  }

  const progressContainer = document.querySelector("#progressContainer");
  const progressBar = document.querySelector("#progressBar");
  const progressText = document.querySelector("#progressText");
  const progressPercent = document.querySelector("#progressPercent");

  // Reset progress state
  progressContainer.style.display = "block";
  progressContainer.dataset.state = "active";
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  progressText.textContent = `Starting ingestion of ${state.selectedFiles.length} file(s)...`;

  // Remove any old result banner
  const oldResult = progressContainer.querySelector(".progress-result");
  if (oldResult) oldResult.remove();

  refs.uploadTrigger.disabled = true;
  setUploadStatus("Ingesting Multimodal Files", `Uploading and embedding files into Pinecone...`, "info");

  try {
    const response = await fetch(endpoint("/api/upload"), {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || `Server error: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalReport = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // Keep partial line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.kind === "progress") {
            const { type, file, index, total } = message;
            const step = type === "file_start" ? 0.2 : 1;
            const percent = Math.min(100, Math.round(((index + step) / total) * 100));

            progressBar.style.width = `${percent}%`;
            progressPercent.textContent = `${percent}%`;

            if (type === "file_start") {
              progressText.textContent = `Processing: ${file} (${index + 1}/${total})`;
            } else if (type === "file_end") {
              const statusEmoji = message.status === "upserted" ? "✅" : message.status === "failed" ? "❌" : "⏭️";
              progressText.textContent = `${statusEmoji} ${file} (${index + 1}/${total})`;
            }
          } else if (message.kind === "report") {
            finalReport = message;
          } else if (message.kind === "error") {
            throw new Error(message.error);
          }
        } catch (e) {
          if (e.message && !e.message.includes("JSON")) throw e;
          console.error("Error parsing progress chunk:", e, line);
        }
      }
    }

    // Show final result
    progressBar.style.width = "100%";
    progressPercent.textContent = "100%";

    if (finalReport) {
      const upserted = finalReport.files.filter(f => f.status === "upserted").length;
      const failed = finalReport.files.filter(f => f.status === "failed").length;
      const skipped = finalReport.files.filter(f => f.status === "skipped").length;
      const allGood = failed === 0;

      progressContainer.dataset.state = allGood ? "done" : "error";
      progressText.textContent = allGood ? "Upload complete!" : "Upload finished with errors";

      // Build result banner
      const resultDiv = document.createElement("div");
      resultDiv.className = `progress-result ${allGood ? "success" : failed === finalReport.files.length ? "error" : "partial"}`;
      const details = [];
      if (upserted > 0) details.push(`✅ ${upserted} file(s) embedded into Pinecone`);
      if (failed > 0) details.push(`❌ ${failed} file(s) failed`);
      if (skipped > 0) details.push(`⏭️ ${skipped} file(s) skipped`);
      resultDiv.innerHTML = details.join("<br>");
      progressContainer.appendChild(resultDiv);

      setUploadStatus(
        allGood ? "Successfully uploaded to Pinecone" : "Ingestion finished with errors",
        `${upserted} embedded, ${failed} failed, ${skipped} skipped.`,
        allGood ? "success" : "error"
      );
    } else {
      progressContainer.dataset.state = "done";
      progressText.textContent = "Upload stream ended.";
    }

    state.selectedFiles = [];
    refs.fileInput.value = "";
    refs.uploadTrigger.disabled = false;
    renderSelectedFiles();
    await loadAssets();

    setTimeout(() => {
      progressContainer.style.display = "none";
      progressContainer.dataset.state = "";
    }, 6000);

  } catch (error) {
    console.error("Upload process error:", error);
    progressContainer.dataset.state = "error";
    progressBar.style.width = "100%";
    progressPercent.textContent = "Error";
    progressText.textContent = `Failed: ${error.message}`;

    // Add error result banner
    const resultDiv = document.createElement("div");
    resultDiv.className = "progress-result error";
    resultDiv.textContent = `❌ ${error.message}`;
    const oldRes = progressContainer.querySelector(".progress-result");
    if (oldRes) oldRes.remove();
    progressContainer.appendChild(resultDiv);

    setUploadStatus("Upload failed", error.message, "error");
    refs.uploadTrigger.disabled = false;
    updateUploadButton();

    setTimeout(() => {
      progressContainer.style.display = "none";
      progressContainer.dataset.state = "";
    }, 8000);
  }
}

async function sendMessage() {
  const message = refs.messageInput.value.trim();
  if (!message) {
    return;
  }

  addMessage("user", message);
  state.history.push({ role: "user", content: message });
  refs.messageInput.value = "";
  setBusy(true);

  try {
    const payload = await fetchJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        history: state.history,
        modality: refs.chatModality.value,
        topK: Number(refs.chatTopK.value || 8)
      })
    });

    addMessage("assistant", payload.answer, payload.sources || []);
    state.history.push({ role: "assistant", content: payload.answer });
  } catch (error) {
    addMessage("assistant", `Error: ${error.message}`);
  } finally {
    setBusy(false);
    refs.messageInput.focus();
  }
}

refs.importTrigger.addEventListener("click", () => refs.fileInput.click());
refs.uploadTrigger.addEventListener("click", () => uploadSelectedFiles());
refs.refreshLibrary.addEventListener("click", async () => {
  await loadAssets();
  await loadStatus();
  setUploadStatus("Library refreshed", "Latest files and service status have been synced.", "info");
});
refs.switchToChat.addEventListener("click", () => setActiveScreen("chat"));
if (refs.goToChat) {
  refs.goToChat.addEventListener("click", () => setActiveScreen("chat"));
}
if (refs.backToUpload) {
  refs.backToUpload.addEventListener("click", () => setActiveScreen("upload"));
}
refs.globalSearch.addEventListener("input", () => renderAssets());
refs.statusToggle.addEventListener("click", () => refs.statusSheet.classList.remove("hidden"));
refs.statusClose.addEventListener("click", () => refs.statusSheet.classList.add("hidden"));
refs.statusSheet.addEventListener("click", (event) => {
  if (event.target === refs.statusSheet) {
    refs.statusSheet.classList.add("hidden");
  }
});

for (const item of refs.navItems) {
  item.addEventListener("click", () => setActiveScreen(item.dataset.screen));
}

for (const chip of refs.promptChips) {
  chip.addEventListener("click", () => {
    refs.messageInput.value = chip.dataset.prompt || "";
    setActiveScreen("chat");
    refs.messageInput.focus();
  });
}

function handleFiles(files) {
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return;

  // Append to current selection, avoiding exact duplicates by name
  const existingNames = new Set(state.selectedFiles.map(f => f.name));
  const newFiles = fileArray.filter(f => !existingNames.has(f.name));

  state.selectedFiles = [...state.selectedFiles, ...newFiles];
  renderSelectedFiles();

  setUploadStatus(
    "Files ready",
    `${state.selectedFiles.length} file(s) staged for embedding and Pinecone storage.`,
    "info"
  );
}

refs.fileInput.addEventListener("change", (event) => {
  handleFiles(event.target.files);
  // Reset input so the same file can be selected again if removed
  refs.fileInput.value = "";
});

if (refs.uploadDropArea) {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    refs.uploadDropArea.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    refs.uploadDropArea.addEventListener(eventName, () => {
      refs.uploadDropArea.classList.add('highlight');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    refs.uploadDropArea.addEventListener(eventName, () => {
      refs.uploadDropArea.classList.remove('highlight');
    }, false);
  });

  refs.uploadDropArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    handleFiles(dt.files);
  }, false);
}

refs.selectedFiles.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const index = target.dataset.removeIndex;
  if (index === undefined) {
    return;
  }

  state.selectedFiles.splice(Number(index), 1);
  renderSelectedFiles();
});

refs.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});

refs.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

addMessage(
  "assistant",
  "Upload media on the first tab, then ask about it here. I will retrieve from Pinecone and show the matching images, videos, or documents under each answer."
);
renderSelectedFiles();
renderAssets();
loadAssets();
loadStatus();
