import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID || process.env.GCS_PROJECT_ID;
const clientEmail = process.env.GCP_CLIENT_EMAIL;
const rawKey = process.env.GCP_PRIVATE_KEY || "";

/**
 * Normalize GCP private key for OpenSSL 3.x compatibility (Node 18+).
 *
 * Railway and many CI platforms store env vars differently:
 *  - .env file:       \\n  (escaped, 2 chars)
 *  - Railway UI:      may store as literal newline OR as \\n depending on how it was pasted
 *  - Some platforms:  double-escaped  \\\\n  (4 chars)
 *
 * This function unifies all cases into a proper PEM string with real newlines.
 */
function normalizePrivateKey(key: string): string {
  // Step 1: Remove surrounding quotes if present (e.g. "-----BEGIN...")
  let k = key.replace(/^["']|["']$/g, "").trim();

  // Step 2: Replace all forms of escaped newlines into real newlines
  // Handles \\n (2-char escape), \\\\n (4-char double-escape), and \r\n
  k = k
    .replace(/\\\\n/g, "\n")  // double-escaped: \\n -> \n
    .replace(/\\n/g, "\n")    // single-escaped: \n  -> real newline
    .replace(/\r\n/g, "\n");  // normalize Windows CRLF

  return k.trim();
}

const privateKey = rawKey ? normalizePrivateKey(rawKey) : undefined;

export const storage = new Storage({
  ...(projectId ? { projectId } : {}),
  ...(clientEmail && privateKey ? {
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
  } : {}),
});

export const bucketName = process.env.GCS_BUCKET_NAME || "huntpuk-images";

