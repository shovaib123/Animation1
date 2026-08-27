import crypto from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// prunaai/p-video-animate — official model (no version hash needed for official models)
const MODEL = "prunaai/p-video-animate";

const s = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });

async function put(key, object) {
  await s().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: JSON.stringify(object),
      ContentType: "application/json"
    })
  );
}

async function signedGet(key) {
  return getSignedUrl(
    s(),
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key
    }),
    { expiresIn: 3600 }
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const {
      imageKey,
      videoKey,
      quality = "720p",
      saveAudio = true
    } = req.body || {};

    if (!process.env.REPLICATE_API_TOKEN || !process.env.APP_BASE_URL) {
      return res.status(500).json({
        error: "Replicate/API environment variables missing"
      });
    }

    if (!imageKey?.startsWith("uploads/") || !videoKey?.startsWith("uploads/")) {
      return res.status(400).json({ error: "Invalid upload keys" });
    }

    const imageUrl = await signedGet(imageKey);
    const videoUrl = await signedGet(videoKey);

    const id = crypto.randomUUID();

    await put(`jobs/${id}.json`, {
      jobId: id,
      status: "starting",
      progress: 40,
      stage: "Starting AI",
      detail: "Preparing character motion transfer",
      imageKey,
      videoKey
    });

    // Official models use /models/{owner}/{name}/predictions (no version)
    const body = {
      input: {
        image: imageUrl,
        video: videoUrl,
        resolution: quality === "1080p" ? "1080p" : "720p",
        target_fps: "original",
        save_audio: !!saveAudio,
        ignore_audio: false,
        turbo: false
      },
      webhook: `${process.env.APP_BASE_URL.replace(/\/$/, "")}/api/replicate-webhook?jobId=${id}`,
      webhook_events_filter: ["start", "completed"]
    };

    const response = await fetch(
      `https://api.replicate.com/v1/models/${MODEL}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Replicate returned invalid response: ${responseText.slice(0, 300)}`
      );
    }

    if (!response.ok) {
      throw new Error(
        data.detail || data.error || `Replicate API error (${response.status})`
      );
    }

    await put(`jobs/${id}.json`, {
      jobId: id,
      predictionId: data.id,
      status: "processing",
      progress: 50,
      stage: "AI processing",
      detail: "Transferring motion onto character",
      imageKey,
      videoKey
    });

    return res.status(200).json({
      jobId: id,
      predictionId: data.id
    });
  } catch (error) {
    console.error("CONVERT ERROR:", error);
    return res.status(500).json({
      error: error?.message || "Server error while starting AI conversion"
    });
  }
}
