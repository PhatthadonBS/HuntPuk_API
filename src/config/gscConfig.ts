import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";
import path from "path";
dotenv.config();

export const storage = new Storage({
  projectId: process.env.GCP_PROJECT_ID!,
  credentials: {
    client_email: process.env.GCP_CLIENT_EMAIL!,
    private_key: process.env.GCP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
  },
});

export const bucketName = "huntpuk-images";

