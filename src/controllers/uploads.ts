import { format } from "mysql2";
import { storage, bucketName } from "../config/gscConfig";
import sharp from "sharp";
import { MulterFiles } from "./dorm_api"; // Ensure this is exported from dorm_api or models

/**
 * Validates, optimizes, and uploads multiple files to GCS.
 * 
 * @param files The req.files object from Multer.
 * @param mainFolder "dorms" or "users"
 * @param folderName Typically the dormId_ownerId or username_userId
 * @param expectedFields An array of field names expected in this upload
 * @returns A mapping of field names to their public GCS URLs. 
 *          Single files return a string. Multiple files (e.g. OTHER_IMG) return string[].
 */
export async function processAndUploadImages(
  files: MulterFiles,
  dormId: number,
  ownerId: number
): Promise<Record<string, string | string[]>> {
  
  const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"]; // Accept webp from frontend if they already convert, but we will convert to webp anyway for consistency and optimization.
  const uploadedUrls: Record<string, string | string[]> = {};
  
  // Create base path: dorms/{dormId}_u{ownerId}/
  const basePath = `dorms/${dormId}_u${ownerId}`;
  const bucket = storage.bucket(bucketName);

  const uploadPromises: Promise<void>[] = [];

  for (const [fieldname, fileArray] of Object.entries(files)) {
    if (!fileArray || fileArray.length === 0) continue;

    const urlsForField: string[] = [];

    for (let index = 0; index < fileArray.length; index++) {
      const file = fileArray[index]!;

      // 1. Validation
      if (!allowedMimeTypes.includes(file.mimetype)) {
         throw new Error(`ข้อผิดพลาด: ไฟล์ ${file.originalname} เป็นประเภทที่ไม่รองรับ (รองรับเฉพาะ JPEG และ PNG) แล้วจะแปลงเป็น WebP ให้อัตโนมัติ`);
      }

      // 2. Naming
      const timestamp = Date.now();
      let newFileName = "";
      
      if (fieldname === "OTHER_IMG") {
        newFileName = `other_${index}_${timestamp}.webp`;
      } else {
        // e.g. FRONT_DORM_IMG -> front_dorm
        const baseName = fieldname.toLowerCase().replace("_img", "");
        newFileName = `${baseName}_${timestamp}.webp`;
      }

      const fullPath = `${basePath}/${newFileName}`;
      const blob = bucket.file(fullPath);

      // 3. Processing and Upload Pipeline
      const uploadPromise = new Promise<void>((resolve, reject) => {
        const blobStream = blob.createWriteStream({
          resumable: false,
          contentType: "image/webp", // We are converting to webp
        });

        blobStream.on("error", (err) => {
          console.error(`GCS Stream Error for ${fullPath}:`, err);
          reject(err);
        });

        blobStream.on("finish", () => {
          const publicUrl = format(
            `https://storage.googleapis.com/${bucket.name}/${blob.name}`
          );
          urlsForField.push(publicUrl);
          resolve();
        });

        // Pipe: Buffer -> Sharp -> GCS Stream
        sharp(file.buffer)
          .resize({ width: 1200, withoutEnlargement: true }) // Max width 1200px
          .webp({ quality: 80 }) // Convert to WebP, 80% quality
          .pipe(blobStream)
          .on("error", (err) => {
             console.error(`Sharp Processing Error for ${file.originalname}:`, err);
             reject(err);
          });
      });

      uploadPromises.push(uploadPromise);
    }

    // Wait for all uploads of THIS field to finish to maintain order if needed, 
    // or we can wait for all at the end. Waiting here makes it easier to assign to the object.
    await Promise.all(uploadPromises);

    // Assign to return object
    if (fieldname === "OTHER_IMG") {
      uploadedUrls[fieldname] = urlsForField;
    } else {
      // For single fields, just return the first URL
      uploadedUrls[fieldname] = urlsForField[0]!;
    }
    
    // clear the array for the next field if we were sharing it (we aren't)
    // uploadPromises.length = 0; 
  }

  // Ensure all promises actually finish (they should have in the loop, but safety first)
  await Promise.all(uploadPromises);

  return uploadedUrls;
}

// Keep the old fileUpload for backwards compatibility with parts of the app not yet refactored (like User Profile)
// But we should consider refactoring those too eventually.
export async function fileUpload(
    file: Express.Multer.File,
    mainFolder: string,
    folderName: string,
    subFolder: string | null,
    fileOf: string
  ) {
    const allowed = ["image/jpeg", "image/png", "image/webp"]; // Added webp here just in case frontend already sends it
    if (!allowed.includes(file.mimetype)) {
      throw new Error("ข้อผิดพลาด: ประเภทไฟล์ไม่ถูกต้อง (รองรับเฉพาะ JPEG, PNG, WEBP)");
    }
  
    if (mainFolder !== "users" && mainFolder !== "dorms") {
      throw new Error("ข้อผิดพลาด: mainFolder ต้องเป็น 'users' หรือ 'dorms'");
    }
  
    if (
      subFolder &&
      subFolder !== "icons" &&
      subFolder !== "room_imgs" &&
      subFolder !== "other_imgs"
    ) {
      throw new Error("ข้อผิดพลาด: subFolder ไม่ถูกต้อง");
    }
  
    return new Promise<string>((resolve, rejects) => {
      const bucket = storage.bucket(bucketName);
      
      // Determine final filename
      const timestamp = Date.now();
      const newFileName = `${fileOf}_${timestamp}.webp`;
      
      const pathParts = [mainFolder, folderName, subFolder]
        .filter((p) => p)
        .map((p) => p?.replace(/[\/\s]/g, "-"));
      const fullPath = `${pathParts.join("/")}/${newFileName}`;
  
      const blob = bucket.file(fullPath);
  
      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: "image/webp", 
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
  
      // Use sharp here too for consistency across the app, even for single uploads like profile pics
      sharp(file.buffer)
          .resize({ width: 1200, withoutEnlargement: true }) 
          .webp({ quality: 80 }) 
          .pipe(blobStream)
          .on("error", (err) => {
             rejects(err);
          });
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

  } catch (error) {
    throw new Error("ข้อผิดพลาด: ไม่สามารถลบโฟลเดอร์ได้");
  }
}