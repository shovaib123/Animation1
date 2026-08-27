import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  try {
    const { key, contentType } = req.body || {};

    if (!key?.startsWith("uploads/")) {
      return res.status(400).json({ error: "Invalid key" });
    }

    const isImage = contentType?.startsWith("image/");
    const isVideo = contentType?.startsWith("video/");
    if (!isImage && !isVideo) {
      return res.status(400).json({ error: "Only image/* or video/* allowed" });
    }

    const uploadUrl = await getSignedUrl(
      s(),
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        ContentType: contentType
      }),
      { expiresIn: 900 }
    );

    res.json({ uploadUrl, key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
