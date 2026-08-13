import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID || process.env.GCS_PROJECT_ID;
const clientEmail = process.env.GCP_CLIENT_EMAIL;
function formatPrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  
  // 1. Remove surrounding quotes if they exist (common in .env)
  let k = key.replace(/^["']|["']$/g, "").trim();

  // 2. Replace literal \n or \\n with actual newlines
  k = k.replace(/\\\\n/g, "\n").replace(/\\n/g, "\n");

  // 3. Fix cases where the key was flattened to a single line with spaces instead of newlines
  if (k.includes("-----BEGIN PRIVATE KEY-----") && !k.includes("\n")) {
    k = k.replace("-----BEGIN PRIVATE KEY-----", "-----BEGIN PRIVATE KEY-----\n");
    k = k.replace("-----END PRIVATE KEY-----", "\n-----END PRIVATE KEY-----");
    const parts = k.split("\n");
    if (parts.length === 3) {
      const body = parts[1]?.replace(/\s+/g, "");
      const formattedBody = body?.match(/.{1,64}/g)?.join("\n") || body;
      k = `${parts[0]}\n${formattedBody}\n${parts[2]}`;
    }
  }

  return k.trim();
}

const privateKey = formatPrivateKey(process.env.GCP_PRIVATE_KEY);

export const storage = new Storage({
  ...(projectId ? { projectId } : {}),
  ...(clientEmail && privateKey ? {
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    }
  } : {}),
});

export const bucketName = process.env.GCS_BUCKET_NAME || "huntpuk-images";

