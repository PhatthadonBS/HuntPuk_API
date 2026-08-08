import { z } from "zod";

export const registerSec1Schema = z.object({
  username: z.string().min(3, "ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร").max(50),
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z
    .string()
    .min(8, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
    .max(16)
    .regex(
      /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*?&#.\-_+]{8,}$/,
      "รหัสผ่านต้องประกอบด้วยตัวอักษรภาษาอังกฤษและตัวเลขอย่างน้อยอย่างละ 1 ตัว (อักขระพิเศษจะมีหรือไม่ก็ได้)",
    ),
  phone: z.string().regex(/^0[0-9]{9}$/, "รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง"),
});

export const loginSchema = z.object({
  email: z.string().email("รูปแบบอีเมลไม่ถูกต้อง"),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน"),
});
