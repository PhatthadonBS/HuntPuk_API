import express from "express";
import multer from "multer";

import * as userController from '../controllers/user_api';
import * as dormController from '../controllers/dorm_api';
import * as testApi from '../controllers/testApi'
import rateLimit from "express-rate-limit";


const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.get('/api', (_req, res) => {
    res.send('HuntPuk_API is running successfully!');
});


const strictLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5,
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
router.get('/api/user/users', userController.getUsers_api);//pass
router.get('/api/user/members', userController.getMembers_api);//pass
router.get('/api/user/dormOwners', userController.getDormOwners_api);//pass
router.post('/api/user/dormOwner', upload.single("file"), userController.requestDormOwner_api);//pass
router.put('/api/user/approve', userController.approveDormOwner);//pass
router.post('/api/user/review', dormController.addReview_api);//pass
router.get('/api/user/dormOwnerReq', dormController.getPendingOwners_api);//pass
   

// auth group
router.post('/api/auth/login', userController.login);//pass
router.post('/api/auth/SendOTP', strictLimiter, userController.OTP_Sender_api);//pass
router.delete('/api/auth/OTPVerify', userController.OTP_Verify_api);//pass
router.post('/api/auth/recoverAccount', userController.recoverAccount_api)//pass


// other data groupt 
router.post('/api/other/mailSenter', userController.resMailSender_api);//pass
router.post('/api/other/addFavorite', userController.addFavorite_api);//pass
router.delete('/api/other/delFavorite', userController.removeFavorite_api);//pass

// ✅ Dormitory group
router.get('/api/dorms/pendingReq', dormController.getPendingDormReq_api);//pass
router.get('/api/dorms/zones', dormController.getAllZones); 
router.get('/api/dorms', dormController.getAllDorms);    
router.get('/api/dorms/admin', dormController.getAllDorms_Admin);//pass    
router.get('/api/dorms/popular', dormController.getPopularDorms_api);//pass        
router.post('/api/dorms', imgTypeUploads, dormController.createDorm_api);//pass
router.post('/api/dorms/approve', dormController.approveDormReq_api);//pass
router.post('/api/dorms/facility', upload.single("fac"), dormController.addFacility_api);//pass
router.get('/api/dorms/facilities', dormController.getFacilities_api);//pass


//specific data group
router.get('/api/spec/user/:id', userController.getUser_api)//pass
router.get('/api/spec/favorite/:id', userController.getMyFavorites_api)//pass
router.delete('/api/spec/dorm/:id', dormController.removeDorm_api)//pass
router.put('/api/spec/restoreDorm/:id', dormController.restoreDorm_api)//pass
router.put('/api/spec/user/:id', userController.updateUser_api)//pass
router.delete('/api/spec/delAccount/:id', userController.deleteAccount_api)//pass
router.put('/api/spec/banAccount/:id', userController.banAccount_api)//pass
router.put('/api/spec/dorm/:id', imgTypeUploads, dormController.updateDorm_api)//pass
router.get('/api/spec/dorm/:id', dormController.getDormsByOwner_api)//pass
router.delete('/api/spec/review/:id', dormController.deleteReview_api)//pass
router.get('/api/dorms/review/:id', dormController.getReviewsByDormId_api);//pass
router.get('/api/dorms/:id', dormController.getDormById);//pass
router.get('/api/dorms/facility/:dorm_id', dormController.getFacilitiesOfDorm_api);//pass
router.put('/api/dorms/facility/:user_id', upload.single("icon"), dormController.updateFacility_api);//pass



export default router;