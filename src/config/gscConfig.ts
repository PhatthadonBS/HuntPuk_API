import { Storage } from "@google-cloud/storage";
import path from "path";


const serviceKey = path.join(__dirname, "../../service-account-key.json");

export const storage = new Storage({
  keyFilename: serviceKey,
  projectId: "huntpuk-479109",
});

export const bucketName = "huntpuk-images";

