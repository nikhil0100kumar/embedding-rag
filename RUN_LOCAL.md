# Run Local RAG Mobile

## Start

To ingest everything already inside [data](/D:/embedding-rag/data) into Pinecone:

```powershell
npm run ingest
```

Then start the backend and local web app in a separate terminal:

Run:

```powershell
npm start
```

Then open in the browser:

```text
http://localhost:3000
```

## What this app does

- `Upload` tab:
  - import files from the browser or Android file picker
  - upload them to the backend
  - embed and store them in Pinecone
- `Chat` tab:
  - embeds your query with Gemini
  - queries Pinecone for top matches
  - sends retrieved context to Groq
  - renders matching media inline in the source cards

## Important env values

Current app config lives in [`.env`](/D:/embedding-rag/.env).

Most important values:

- `EMBEDDING_MODEL=gemini-embedding-2-preview`
- `EMBEDDING_DIMENSION=1536`
- `PINECONE_INDEX_NAME=multimodal-rag`
- `PINECONE_NAMESPACE=default`
- `GENERATION_MODEL=openai/gpt-oss-120b`

## Pinecone host

The server can auto-discover your Pinecone host from `PINECONE_INDEX_NAME`.

If that lookup fails in your environment, set this manually in `.env`:

```text
PINECONE_INDEX_HOST=your-index-host-here
```

It usually looks something like:

```text
your-index-name-xxxx.svc.<region>.pinecone.io
```

## Assumptions about your vectors

This chat UI works best if your Pinecone metadata includes fields like:

- `modality`
- `title`
- `text_preview`
- `file_uri`
- `source_id`

If those fields are missing, the chat still works, but the source cards will be less informative.

## Capacitor Android

This project is set up so the app UI can be wrapped by Capacitor while the API stays on your backend server.

1. Keep `npm start` running on your computer.
2. Edit [public/runtime-config.js](/D:/embedding-rag/public/runtime-config.js) and set:

```js
apiBaseUrl: "http://YOUR-LAPTOP-LAN-IP:3000"
```

3. Copy the web assets into Capacitor:

```powershell
npm run cap:copy
```

4. Sync the Android project:

```powershell
npm run cap:sync
```

5. Open Android Studio:

```powershell
npm run cap:android
```

For Android local testing over HTTP, [capacitor.config.json](/D:/embedding-rag/capacitor.config.json) already enables cleartext traffic.
