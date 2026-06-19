import express from "express";
import multer from "multer";

import * as userController from '../controllers/user_api';
import * as dormController from '../controllers/dorm_api';
import * as testApi from '../controllers/testApi'
import rateLimit from "express-rate-limit";
import { verifyToken, verifyTokenOptional } from "../middlewares/auth_middleware";


const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.get('/api', (_req, res) => {
    res.send('HuntPuk_API is running successfully!');
});


const strictLimiter = rateLimit({
  windowMs: 3 * 60 * 1000,
  max: 1,
});

const imgTypeUploads = upload.fields([
    {name: "FRONT_DORM_IMG", maxCount: 1},
    {name: "LICENSE_IMG", maxCount: 1},
    {name: "FACILITY_IMG", maxCount: 1},
    {name: "CEILING_IMG", maxCount: 1},
    {name: "WALL_IMG", maxCount: 1},
    {name: "FLOOR_IMG", maxCount: 1},
    {name: "BED_IMG", maxCount: 1},
    {name: "BATHROOM_IMG", maxCount: 1},
    {name: "BALCONY_IMG", maxCount: 1},
    {name: "OTHER_IMG", maxCount: 5}
])
//
//////////////////// test api zone ///////////////////////////////
router.post('/api/test', imgTypeUploads, dormController.createDorm_api);
// router.post('/test2', imgTypeUploads,testApi.createDorm_api);
router.get('/api/test', testApi.test_send);

router.post('/api/test2', testApi.test_send);
//////////////////// test api zone ///////////////////////////////

//user data group
router.post('/api/user/registerSec1', userController.registerSec1);//pass
router.post('/api/user/registerSec2', userController.registerSec2);//pass
router.put('/api/user/resetPassword', userController.resetPassword_api);//pass
router.get('/api/user/users', verifyToken, userController.getUsers_api);//pass
router.get('/api/user/members', verifyToken, userController.getMembers_api);//pass
router.get('/api/user/dormOwners', verifyToken, userController.getDormOwners_api);//pass
router.post('/api/user/dormOwner', verifyToken, upload.single("file"), userController.requestDormOwner_api);//pass
router.put('/api/user/approve', verifyToken, userController.approveDormOwner);//pass
router.post('/api/user/review', verifyToken, dormController.addReview_api);//pass
router.get('/api/user/dormOwnerReq', verifyToken, dormController.getPendingOwners_api);//pass
   

// auth group
router.post('/api/auth/login', userController.login);//pass
router.post('/api/auth/SendOTP/register', strictLimiter, userController.OTP_Sender_Reg_api);
router.post('/api/auth/SendOTP/reset', strictLimiter, userController.OTP_Sender_Reset_api);
router.post('/api/auth/SendOTP', strictLimiter, userController.OTP_Sender_api);//pass
router.delete('/api/auth/OTPVerify', userController.OTP_Verify_api);//pass
router.post('/api/auth/recoverAccount', userController.recoverAccount_api)//pass


// other data groupt 
router.post('/api/other/mailSenter', userController.resMailSender_api);//pass
router.post('/api/other/addFavorite', verifyToken, userController.addFavorite_api);//pass
router.delete('/api/other/delFavorite', verifyToken, userController.removeFavorite_api);//pass

// ✅ Dormitory group
router.get('/api/dorms/pendingReq', verifyToken, dormController.getPendingDormReq_api);//pass
router.get('/api/dorms/zones', dormController.getAllZones); 
router.get('/api/dorms/dormTypes', dormController.getAllDormTypes);
router.get('/api/dorms/roomTypes', dormController.getAllRoomTypes);
router.get('/api/dorms/bedTypes', dormController.getAllBedTypes);
router.get('/api/dorms', dormController.getAllDorms);    
router.get('/api/dorms/mobile', verifyTokenOptional, dormController.getAllDormMB);
router.get('/api/dorms/admin', verifyToken, dormController.getAllDorms_Admin);//pass    
router.get('/api/dorms/popular', dormController.getPopularDorms_api);//pass        
router.post('/api/dorms', verifyToken, imgTypeUploads, dormController.createDorm_api);//pass
router.post('/api/dorms/mobile', verifyToken, dormController.createDormMB_api);
router.post('/api/dorms/mobile/:id/images', verifyToken, imgTypeUploads, dormController.uploadDormImagesMB_api);
router.post('/api/dorms/approve', verifyToken, dormController.approveDormReq_api);//pass
router.post('/api/dorms/facility', verifyToken, upload.single("fac"), dormController.addFacility_api);//pass
router.get('/api/dorms/facilities', dormController.getFacilities_api);//pass
router.get('/api/dorms/facilities/pending', verifyToken, dormController.getPendingFacilities_api);
router.put('/api/dorms/facility/approve/:fac_id', verifyToken, dormController.approveFacilityReq_api);
router.put('/api/dorms/changeStatus/:id', verifyToken, dormController.changeDormStatus_api);
 
//specific data group
router.get('/api/spec/user/:id', verifyToken, userController.getUser_api)//pass
router.get('/api/spec/favorite/:id', verifyToken, userController.getMyFavorites_api)//pass
router.delete('/api/spec/dorm/:id', verifyToken, dormController.removeDorm_api)//pass
router.put('/api/spec/restoreDorm/:id', verifyToken, dormController.restoreDorm_api)//pass
router.put('/api/spec/user/:id', verifyToken, upload.single('file'), userController.updateUser_api)//pass
router.delete('/api/spec/delAccount/:id', verifyToken, userController.deleteAccount_api)//pass
router.put('/api/spec/banAccount/:id', verifyToken, userController.banAccount_api)//pass
router.put('/api/spec/unbanAccount/:id', verifyToken, userController.unbanAccount_api)//pass
router.put('/api/spec/dorm/:id', verifyToken, imgTypeUploads, dormController.updateDorm_api)//pass
router.get('/api/spec/dorm/:id', dormController.getDormsByOwner_api)//pass
router.delete('/api/spec/review/:id', verifyToken, dormController.deleteReview_api)//pass
router.get('/api/dorms/review/:id', dormController.getReviewsByDormId_api);//pass
router.get('/api/dorms/:id', dormController.getDormById);//pass
router.get('/api/dorms/facility/:dorm_id', dormController.getFacilitiesOfDorm_api);//pass
router.put('/api/dorms/facility/:user_id', verifyToken, upload.single("icon"), dormController.updateFacility_api);//pass
router.get('/api/admin/facilities/requests', verifyToken, dormController.getFacilityRequests_api);
router.put('/api/admin/facilities/approve/:fac_id', verifyToken, dormController.approveFacilityRequest_api);
router.delete('/api/admin/facilities/reject/:fac_id', verifyToken, dormController.rejectFacilityRequest_api);
router.delete('/api/admin/facilities/:fac_id', verifyToken, dormController.deleteFacility_api);

export default router;
