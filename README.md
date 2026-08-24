# Animov AI V2 — Vercel + Cloudflare R2 + Replicate

Upload goes directly from browser to Cloudflare R2 using a temporary presigned PUT URL. Vercel only creates signed URLs and AI jobs. Replicate performs the video-to-video generation and calls the Vercel webhook. The webhook verifies the Replicate signature, downloads the AI output, and saves it to R2. The frontend polls the job stored in R2.

## Vercel environment variables
REPLICATE_API_TOKEN
REPLICATE_WEBHOOK_SECRET
R2_ACCOUNT_ID
R2_BUCKET_NAME
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
APP_BASE_URL

Do not put secrets in HTML or GitHub.

## Cloudflare R2
Create/use your R2 bucket. Create an R2 API token with Object Read & Write permission scoped to this bucket. Configure bucket CORS to allow your Vercel domain for PUT/GET/HEAD and Content-Type.

## Replicate
Use a Replicate API token. Get the default webhook signing secret from:
https://api.replicate.com/v1/webhooks/default/secret
Put its `key` value in REPLICATE_WEBHOOK_SECRET.

## Deploy
Upload this project to GitHub, import the repo into Vercel, add the environment variables, and redeploy.

## Model limitation
The selected Wan 2.1 video-to-video model accepts up to 100 frames (81 default) and is intended for short clips. This version is the real end-to-end test architecture. A full movie requires a separate queue + GPU worker + scene/chunk pipeline; Vercel should not be the long-running video worker.
