import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID || process.env.GCS_PROJECT_ID;
const clientEmail = process.env.GCP_CLIENT_EMAIL;
function formatPrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  
  let k = key.trim();
  
  // 1. Remove surrounding quotes if they exist (common in .env)
  if (k.startsWith('"') && k.endsWith('"')) {
    k = k.substring(1, k.length - 1);
  } else if (k.startsWith("'") && k.endsWith("'")) {
    k = k.substring(1, k.length - 1);
  }

  // 2. Unescape newlines (replace literal "\n" and "\\n" with actual newline)
  k = k.split("\\\\n").join("\n").split("\\n").join("\n");
  
  // 3. Normalize \r\n to \n
  k = k.split("\r\n").join("\n");

  // 4. Fix cases where the key was flattened to a single line with spaces
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

