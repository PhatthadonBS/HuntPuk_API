import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";
import path from "path";

dotenv.config();

const projectId = process.env.GCP_PROJECT_ID || process.env.GCS_PROJECT_ID;
const clientEmail = process.env.GCP_CLIENT_EMAIL;
const privateKey = process.env.GCP_PRIVATE_KEY;

export const storage = new Storage({
  ...(projectId ? { projectId } : {}),
  ...(clientEmail && privateKey ? {
    credentials: {
      client_email: clientEmail,
      private_key: privateKey.replace(/\\n/g, "\n"),
    }
  } : {}),
});

export const bucketName = process.env.GCS_BUCKET_NAME || "huntpuk-images";

