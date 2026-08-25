import crypto from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const V =
  "9349766527ed95fa6194dcca4cae3d497357e207025beb0b97fb0403420142b8";

const s = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });

const P = {
  anime:
    "Transform this video into a high quality Japanese anime film. Preserve the same subjects, actions, clothing, camera movement and composition. Clean anime line art, faithful faces, cel shading, detailed animated environment, stable characters and temporal consistency.",

  cartoon:
    "Transform this video into a polished 2D animated cartoon. Preserve the same subjects, actions, clothing, camera movement and composition. Clean outlines, cel shading, colorful animated background and stable motion.",

  comic:
    "Transform this video into a cinematic comic-book animation. Preserve the same action, subjects and camera movement. Bold ink outlines, graphic shading and coherent temporal motion.",

  "3d":
    "Transform this video into a stylized 3D animated movie. Preserve the same subjects, action, clothing, camera movement and composition. Smooth 3D character appearance, cinematic lighting and stable motion.",

  cinema:
    "Transform this video into a high-end animated feature film. Preserve the same subjects, action and camera movement. Stylized characters, cinematic lighting and coherent motion.",

  sketch:
    "Transform this video into a hand-drawn animated film. Preserve the same subjects, action and framing. Clean pencil and ink lines, illustrated shading and stable motion."
};

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "POST only"
    });
  }

  try {
    const {
      key,
      style = "anime",
      quality = "480",
      strength = ".7"
    } = req.body || {};

    // Check required environment variables
    if (
      !process.env.REPLICATE_API_TOKEN ||
      !process.env.APP_BASE_URL
    ) {
      return res.status(500).json({
        error:
          "Replicate/API environment variables missing"
      });
    }

    // Validate uploaded file key
    if (!key || !key.startsWith("uploads/")) {
      return res.status(400).json({
        error: "Invalid upload"
      });
    }

    // Create temporary signed URL for the source video
    const input = await getSignedUrl(
      s(),
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key
      }),
      {
        expiresIn: 3600
      }
    );

    // Create job ID
    const id = crypto.randomUUID();

    // Save initial job state
    await put(`jobs/${id}.json`, {
      jobId: id,
      status: "starting",
      progress: 20,
      stage: "Starting AI",
      detail: "Preparing video-to-video generation",
      sourceKey: key
    });

    // Prepare Replicate request
    const body = {
      version: V,

      input: {
        prompt: P[style] || P.anime,

        negative_prompt:
          "low quality, blurry, distorted, disfigured, flicker, inconsistent face, extra limbs, text, watermark",

        input_video: input,

        tiled: true,

        cfg_scale: 6,

        num_frames: 81,

        frames_per_second: 16,

        denoising_strength: Math.min(
          1,
          Math.max(0.1, Number(strength) || 0.7)
        ),

        aspect_ratio:
          quality === "720"
            ? "1280x720"
            : "832x480",

        num_inference_steps: 30
      },

      webhook:
        `${process.env.APP_BASE_URL.replace(/\/$/, "")}/api/replicate-webhook?jobId=${id}`,

      webhook_events_filter: [
        "start",
        "completed"
      ]
    };

    // Send request to Replicate
    const response = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.REPLICATE_API_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body: JSON.stringify(body)
      }
    );

    // Read Replicate response safely
    const responseText = await response.text();

    let data;

    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(
        `Replicate returned invalid response: ${responseText.slice(
          0,
          300
        )}`
      );
    }

    // Replicate error
    if (!response.ok) {
      throw new Error(
        data.detail ||
          data.error ||
          `Replicate API error (${response.status})`
      );
    }

    // Save processing state
    await put(`jobs/${id}.json`, {
      jobId: id,
      predictionId: data.id,
      status: "processing",
      progress: 30,
      stage: "AI processing",
      detail:
        "GPU video-to-video generation started",
      sourceKey: key
    });

    // Return job ID to frontend
    return res.status(200).json({
      jobId: id,
      predictionId: data.id
    });

  } catch (error) {
    console.error("CONVERT ERROR:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Server error while starting AI conversion"
    });
  }
}
