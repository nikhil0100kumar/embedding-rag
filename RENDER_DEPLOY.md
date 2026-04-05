# Deploying to Render

Follow these steps to deploy this Multimodal RAG backend to Render.

## Prerequisites
- A [Render](https://render.com/) account.
- Your code pushed to a GitHub or GitLab repository.

## Step 1: Create a New Web Service
1. Click **New +** in the Render dashboard and select **Web Service**.
2. Connect your repository.
3. Use the following configuration:
   - **Name**: `multimodal-rag-backend` (or your preferred name)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

## Step 2: Configure Environment Variables
In the **Environment** tab of your Render service, add the following variables:

| Variable | Description |
| --- | --- |
| `GEMINI_API_KEY` | Your Google Gemini API Key |
| `PINECONE_API_KEY` | Your Pinecone API Key |
| `GROQ_API_KEY` | Your Groq API Key |
| `PINECONE_INDEX_NAME` | The name of your Pinecone index |
| `PORT` | Set to `3000` (Render will override this, but good to have) |
| `CORS_ALLOW_ORIGIN` | Set to your frontend URL or `*` for initial testing |

## Step 3: Persistent Storage (Optional but Recommended)
Render's free tier has an ephemeral disk. If you upload files, they will be deleted when the service restarts.
To keep your uploaded files:
1. Go to the **Disk** tab in Render.
2. Add a Disk:
   - **Name**: `data-storage`
   - **Mount Path**: `/data`
   - **Size**: `1GB` (or as needed)
3. In your **Environment Variables**, set `DATA_DIR` to `/data`.

## Step 4: Deploy
Click **Create Web Service**. Render will build and deploy your app.

## Frontend Update
Once deployed, copy your Render service URL (e.g., `https://multimodal-rag-backend.onrender.com`) and update your frontend's `runtime-config.js` or `APP_CONFIG` to point to this new URL.
