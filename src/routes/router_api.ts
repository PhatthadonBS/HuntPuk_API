import express from "express";
import multer from "multer";

import * as userController from "../controllers/user_api";
import * as dormController from "../controllers/dorm_api";
import * as viewController from "../controllers/view_api";
import * as dashboardController from "../controllers/dashboard_api";
import rateLimit from "express-rate-limit";
import {
  verifyToken,
  verifyTokenOptional,
  requireRole,
} from "../middlewares/auth_middleware";
import { cacheMiddleware } from "../middlewares/cache";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = express.Router();

router.get("/api", (_req, res) => {
  res.send("Hi")
});

// View Statistics Routes
router.post("/api/views/website", viewController.recordWebsiteView);
router.post("/api/views/dorm/:id", viewController.recordDormView);

// Dashboard Routes
router.get(
  "/api/dashboard/stats",
  verifyToken,
  requireRole(3),
  dashboardController.getDashboardStats_api,
);
router.get(
  "/api/dashboard/dorm-views/:id",
  verifyToken,
  requireRole(3),
  dashboardController.getDormViewsStats_api,
);

const strictLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: "มีการส่งคำขอถี่เกินไป กรุณาลองใหม่อีกครั้งหลังจาก 3 นาที",
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: "พยายามเข้าสู่ระบบมากเกินไปจาก IP นี้ กรุณาลองใหม่อีกครั้งหลังจาก 15 นาที",
});

// ป้องกัน Mail Bombing: 5 ครั้ง / 1 ชั่วโมง ต่อ IP
const mailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: "ส่งคำขอส่งอีเมลมากเกินไปจาก IP นี้ กรุณาลองใหม่อีกครั้งหลังจาก 1 ชั่วโมง",
});

const imgTypeUploads = upload.fields([
  { name: "FRONT_DORM_IMG", maxCount: 1 },
  { name: "LICENSE_IMG", maxCount: 1 },
  { name: "FACILITY_IMG_0", maxCount: 1 },
  { name: "FACILITY_IMG_1", maxCount: 1 },
  { name: "FACILITY_IMG_2", maxCount: 1 },
  { name: "CEILING_IMG", maxCount: 1 },
  { name: "WALL_IMG", maxCount: 1 },
  { name: "FLOOR_IMG", maxCount: 1 },
  { name: "BED_IMG", maxCount: 1 },
  { name: "BATHROOM_IMG", maxCount: 1 },
  { name: "BALCONY_IMG", maxCount: 1 },
  { name: "OTHER_IMG", maxCount: 5 },
]);

//user data group
router.post("/api/user/registerSec1", userController.registerSec1);
router.post(
  "/api/user/registerSec2",
  verifyTokenOptional,
  userController.registerSec2,
);
router.put("/api/user/resetPassword", userController.resetPassword_api);
router.get("/api/user/users", verifyToken, userController.getUsers_api);
router.get("/api/user/members", verifyToken, userController.getMembers_api);
router.get(
  "/api/user/dormOwners",
  verifyToken,
  userController.getDormOwners_api,
);
router.get(
  "/api/user/myDormOwnerReq",
  verifyToken,
  userController.getMyDormOwnerReq_api,
);
router.post(
  "/api/user/dormOwner",
  verifyToken,
  upload.single("file"),
  userController.requestDormOwner_api,
);
router.put(
  "/api/user/approve",
  verifyToken,
  requireRole(3),
  userController.approveDormOwner,
);
router.post("/api/user/review", verifyToken, dormController.addReview_api);
router.get(
  "/api/user/dormOwnerReq",
  verifyToken,
  requireRole(1, 2, 3),
  dormController.getPendingOwners_api,
);
router.get(
  "/api/user/dormOwnerReqAll",
  verifyToken,
  requireRole(3),
  dormController.getAllOwnerRequests_api,
);

// auth group
router.post("/api/auth/login", loginLimiter, userController.login);
router.post(
  "/api/auth/refresh-token",
  verifyToken,
  userController.refreshToken,
);
router.post(
  "/api/auth/SendOTP/register",
  strictLimiter,
  userController.OTP_Sender_Reg_api,
);
router.post(
  "/api/auth/SendOTP/reset",
  strictLimiter,
  userController.OTP_Sender_Reset_api,
);
router.post("/api/auth/SendOTP", strictLimiter, userController.OTP_Sender_api);
router.delete("/api/auth/OTPVerify", userController.OTP_Verify_api);
router.post("/api/auth/recoverAccount", userController.recoverAccount_api);

// other data groupt
router.post("/api/other/mailSenter", mailLimiter, userController.resMailSender_api);
router.post(
  "/api/other/addFavorite",
  verifyToken,
  userController.addFavorite_api,
);
router.delete(
  "/api/other/delFavorite",
  verifyToken,
  userController.removeFavorite_api,
);

// ✅ Dormitory group
router.put(
  "/api/dorms/cancel-request/:id",
  verifyToken,
  requireRole(2),
  dormController.cancelDormRequest_api,
);
router.get(
  "/api/dorms/pendingReq",
  verifyToken,
  requireRole(3),
  dormController.getPendingDormReq_api,
);
router.get(
  "/api/dorms/zones",
  cacheMiddleware(3600),
  dormController.getAllZones,
);
router.post(
  "/api/dorms/zones",
  verifyToken,
  requireRole(3),
  dormController.addDormZone,
);
router.delete(
  "/api/dorms/zones/:id",
  verifyToken,
  requireRole(3),
  dormController.deleteDormZone,
);
router.get(
  "/api/dorms/dormTypes",
  cacheMiddleware(3600),
  dormController.getAllDormTypes,
);
router.post(
  "/api/dorms/dormTypes",
  verifyToken,
  requireRole(3),
  dormController.addDormType,
);
router.delete(
  "/api/dorms/dormTypes/:id",
  verifyToken,
  requireRole(3),
  dormController.deleteDormType,
);
router.get(
  "/api/dorms/roomTypes",
  cacheMiddleware(3600),
  dormController.getAllRoomTypes,
);
router.post(
  "/api/dorms/roomTypes",
  verifyToken,
  requireRole(3),
  dormController.addRoomType,
);
router.delete(
  "/api/dorms/roomTypes/:id",
  verifyToken,
  requireRole(3),
  dormController.deleteRoomType,
);
router.get(
  "/api/dorms/bedTypes",
  cacheMiddleware(3600),
  dormController.getAllBedTypes
);
router.post(
  "/api/dorms/bedTypes",
  verifyToken,
  requireRole(3),
  dormController.addBedType,
);
router.delete(
  "/api/dorms/bedTypes/:id",
  verifyToken,
  requireRole(3),
  dormController.deleteBedType,
);
router.get(
  "/api/dorms/priceTypes",
  cacheMiddleware(3600),
  dormController.getAllPriceTypes
);
router.post(
  "/api/dorms/priceTypes",
  verifyToken,
  requireRole(3),
  dormController.addPriceType,
);
router.delete(
  "/api/dorms/priceTypes/:id",
  verifyToken,
  requireRole(3),
  dormController.deletePriceType,
);
router.get(
  "/api/dorms/dormStatuses",
  cacheMiddleware(3600),
  dormController.getAllDormStatuses
);
router.post(
  "/api/dorms/dormStatuses",
  verifyToken,
  requireRole(3),
  dormController.addDormStatus,
);
router.delete(
  "/api/dorms/dormStatuses/:id",
  verifyToken,
  requireRole(3),
  dormController.deleteDormStatus,
);

// Unified endpoint for editing master types
router.put(
  "/api/type_management/:type/:id",
  verifyToken,
  requireRole(3),
  dormController.updateMasterType,
);
router.get("/api/dorms", dormController.getAllDorms);
router.get(
  "/api/dorms/mobile",
  verifyTokenOptional,
  dormController.getAllDormMB,
);
router.get(
  "/api/dorms/admin",
  verifyToken,
  requireRole(3),
  dormController.getAllDorms_Admin,
);
router.get(
  "/api/dorms/admin/mobile",
  verifyToken,
  requireRole(3),
  dormController.getAllDorms_Admin_Mobile,
);
router.get("/api/dorms/popular", dormController.getPopularDorms_api);
router.post(
  "/api/dorms",
  verifyToken,
  imgTypeUploads,
  dormController.createDorm_api,
);
router.post("/api/dorms/mobile", verifyToken, dormController.createDormMB_api);
router.post(
  "/api/dorms/mobile/:id/images",
  verifyToken,
  imgTypeUploads,
  dormController.uploadDormImagesMB_api,
);
router.post(
  "/api/dorms/approve",
  verifyToken,
  requireRole(3),
  dormController.approveDormReq_api,
);
router.post(
  "/api/dorms/facility",
  verifyToken,
  upload.single("fac"),
  dormController.addFacility_api,
);
router.get(
  "/api/dorms/facilities",
  cacheMiddleware(3600),
  dormController.getFacilities_api,
);
router.get(
  "/api/dorms/facilities/pending",
  verifyToken,
  requireRole(3),
  dormController.getFacilityRequests_api,
);
router.put(
  "/api/dorms/facility/approve/:fac_id",
  verifyToken,
  requireRole(3),
  dormController.approveFacilityRequest_api,
);
router.put(
  "/api/dorms/changeStatus/:id",
  verifyToken,
  requireRole(2, 3),
  dormController.changeDormStatus_api,
);

//specific data group
router.get("/api/spec/user/:id", verifyToken, userController.getUser_api);
router.get(
  "/api/spec/favorite/:id",
  verifyToken,
  userController.getMyFavorites_api,
);
router.delete("/api/spec/dorm/:id", verifyToken, dormController.removeDorm_api);
router.put(
  "/api/spec/restoreDorm/:id",
  verifyToken,
  requireRole(2, 3),
  dormController.restoreDorm_api,
);
router.put(
  "/api/spec/user/:id",
  verifyToken,
  upload.single("file"),
  userController.updateUser_api,
);
router.delete(
  "/api/spec/delAccount/:id",
  verifyToken,
  userController.deleteAccount_api,
);
router.delete(
  "/api/admin/users/hardDelete/:id",
  verifyToken,
  requireRole(3),
  userController.hardDeleteAccount_api,
);
router.put(
  "/api/spec/banAccount/:id",
  verifyToken,
  requireRole(3),
  userController.banAccount_api,
);
router.put(
  "/api/spec/unbanAccount/:id",
  verifyToken,
  requireRole(3),
  userController.unbanAccount_api,
);
router.put(
  "/api/spec/dorm/:id",
  verifyToken,
  imgTypeUploads,
  dormController.updateDorm_api,
);
router.get(
  "/api/spec/dorm/:id",
  verifyToken,
  dormController.getDormsByOwner_api
);
router.delete(
  "/api/spec/review/:id",
  verifyToken,
  dormController.deleteReview_api,
);
router.get("/api/dorms/review/:id", dormController.getReviewsByDormId_api);
router.get(
  "/api/dorms/facility-req-count",
  verifyToken,
  requireRole(2, 3),
  dormController.getFacilityReqCount_api,
);
router.get("/api/dorms/:id", dormController.getDormById);
router.get(
  "/api/dorms/facility/:dorm_id",
  dormController.getFacilitiesOfDorm_api,
);
router.put(
  "/api/dorms/facility/:user_id",
  verifyToken,
  upload.single("icon"),
  dormController.updateFacility_api,
);
router.get(
  "/api/admin/facilities/requests",
  verifyToken,
  requireRole(3),
  dormController.getFacilityRequests_api,
);
router.put(
  "/api/admin/facilities/approve/:fac_id",
  verifyToken,
  requireRole(3),
  dormController.approveFacilityRequest_api,
);
router.delete(
  "/api/admin/facilities/reject/:fac_id",
  verifyToken,
  requireRole(3),
  dormController.rejectFacilityRequest_api,
);
router.delete(
  "/api/admin/facilities/:fac_id",
  verifyToken,
  requireRole(3),
  dormController.deleteFacility_api,
);

export default router;
