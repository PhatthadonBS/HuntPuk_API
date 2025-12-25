import express from "express";
import multer from "multer";

import * as userController from '../controllers/user_api';
import * as dormController from '../controllers/dorm_api';
import * as testApi from '../controllers/testApi'


const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.get('/', (_req, res) => {
    res.send('HuntPuk_API is running successfully!');
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
router.post('/test', imgTypeUploads, dormController.createDorm_api);
// router.post('/test2', imgTypeUploads,testApi.createDorm_api);
router.get('/test', testApi.test_send);
//////////////////// test api zone ///////////////////////////////

//user data group
router.post('/user/registerSec1', userController.registerSec1);//pass
router.post('/user/registerSec2', userController.registerSec2);//pass
router.put('/user/resetPassword', userController.resetPassword_api);//pass
router.get('/user/users', userController.getUsers_api);//pass
router.get('/user/members', userController.getMembers_api);//pass
router.get('/user/dormOwners', userController.getDormOwners_api);//pass
router.post('/user/dormOwner', upload.single("file"), userController.requestDormOwner_api);//pass
router.put('/user/approve', userController.approveDormOwner);//pass
router.post('/user/review', dormController.addReview_api);//pass
router.get('/user/dormOwnerReq', dormController.getPendingOwners_api);//pass


// auth group
router.post('/auth/login', userController.login);//pass
router.post('/auth/SendOTP', userController.OTP_Sender_api);//pass
router.delete('/auth/OTPVerify', userController.OTP_Verify_api);//pass
router.post('/auth/recoverAccount', userController.recoverAccount_api)//pass


// other data groupt 
router.post('/other/mailSenter', userController.resMailSender_api);//pass
router.post('/other/addFavorite', userController.addFavorite_api);//pass
router.delete('/other/delFavorite', userController.removeFavorite_api);//pass

// ✅ Dormitory group
router.get('/dorms/pendingReq', dormController.getPendingDormReq_api);//pass
router.get('/dorms/zones', dormController.getAllZones); 
router.get('/dorms', dormController.getAllDorms);    
router.get('/dorms/admin', dormController.getAllDorms_Admin);//pass    
router.get('/dorms/popular', dormController.getPopularDorms_api);//pass        
router.post('/dorms', imgTypeUploads, dormController.createDorm_api);//pass
router.post('/dorms/approve', dormController.approveDormReq_api);//pass
router.post('/dorms/facility', upload.single("fac"), dormController.addFacility_api);//pass


//specific data group
router.get('/spec/user/:id', userController.getUser_api)//pass
router.get('/spec/favorite/:id', userController.getMyFavorites_api)//pass
router.delete('/spec/dorm/:id', dormController.removeDorm_api)//pass
router.put('/spec/restoreDorm/:id', dormController.restoreDorm_api)//pass
router.put('/spec/user/:id', userController.updateUser_api)//pass
router.delete('/spec/delAccount/:id', userController.deleteAccount_api)//pass
router.put('/spec/banAccount/:id', userController.banAccount_api)//pass
router.put('/spec/dorm/:id', imgTypeUploads, dormController.updateDorm_api)//pass
router.get('/spec/dorm/:id', dormController.getDormsByOwner_api)//pass
router.delete('/spec/review/:id', dormController.deleteReview_api)//pass
router.get('/dorms/review/:id', dormController.getReviewsByDormId_api);//pass
router.get('/dorms/:id', dormController.getDormById);   



export default router;