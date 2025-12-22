import { format } from "mysql2";
import { storage, bucketName } from "../config/gscConfig";
import { promises } from "dns";

export async function fileUpload(
  file: Express.Multer.File,
  mainFolder: string,
  folderName: string,
  subFolder: string | null,
  fileOf: string
) {
  const allowed = ["image/jpeg", "image/png"];
  if (!allowed.includes(file.mimetype)) {
    throw new Error("Invalid file type");
  }

  if (mainFolder !== "users" && mainFolder !== "dorms") {
    throw new Error("Invalid mainFolder: Must be 'users' or 'dorms'");
  }

  if (
    subFolder &&
    subFolder !== "icon" &&
    subFolder !== "room_img" &&
    subFolder !== "other_img"
  ) {
    throw new Error("Invalid subFolder");
  }

  return new Promise<string>((resolve, rejects) => {
    const bucket = storage.bucket(bucketName);
    const ext = file.mimetype.split("/")[1];
    const pathParts = [mainFolder, folderName, subFolder]
      .filter((p) => p)
      .map((p) => p?.replace(/[\/\s]/g, "-"));
    const fileName = `${fileOf}_${Date.now()}.${ext}`;
    const fullPath = `${pathParts.join("/")}/${fileName}`;

    const blob = bucket.file(fullPath);

    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
    });

    blobStream.on("error", (err) => {
      rejects(err);
    });

    blobStream.on("finish", async () => {
      const publicUrl = format(
        `https://storage.googleapis.com/${bucket.name}/${blob.name}`
      );
      resolve(publicUrl);
    });

    blobStream.end(file.buffer);
  });
}

export async function deleteFromGCS(publicUrl: string): Promise<boolean> {
  try {
    if (!publicUrl) return false;
    
    const url = new URL(publicUrl);

    const filePath = decodeURIComponent(url.pathname.split("/").slice(2).join("/"));

    const bucket = storage.bucket(bucketName);
    const file = bucket.file(filePath);

    await file.delete({ ignoreNotFound: true });

    return true;
  } catch (err) {
    console.error("Delete GCS failed", err);
    return false;
  }
}

export async function deleteFolder(folderName: string) {
  const folderToDelete = `dorms/${folderName}/`;

  try {

    await storage.bucket(bucketName).deleteFiles({
      prefix: `dorms/${folderName}/`,
      force: true,
    });

    console.log(`ลบ${folderToDelete} เรียบร้อยแล้ว`);
  } catch (error) {
    throw error;
  }
}
