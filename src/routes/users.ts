import { Router } from 'express';
import userController from '../controllers/UserController.js';
import { authenticateToken } from '../utils/authMiddleWare.js';
import { validate } from '../middleware/validation.js';
import { userSchemas } from '../validators/schemas/index.js';

const router = Router();

// Public routes
router.get('/check-username', validate(userSchemas.checkUsernameAvailabilitySchema), userController.checkUsernameAvailability);
router.get('/', validate(userSchemas.getUsersSchema), userController.getUsers);

// Protected routes (allow suspended users for profile completion)
router.post('/complete-profile', validate(userSchemas.completeUserProfileSchema), userController.completeUserProfile);

// Protected routes (require active account)
//router.use(authMiddleware);

router.get('/me', authenticateToken, userController.getMe);
router.get('/me/activity-log', authenticateToken, validate(userSchemas.getActivityLogSchema), userController.getActivityLog);
router.get('/current', authenticateToken, userController.getCurrentUser);
//This function is deprecated use /api/1.0.0/media/upload/image and set targetType to USER
router.put('/profile-picture', validate(userSchemas.updateUserProfilePictureSchema), userController.updateUserProfilePicture);
router.delete('/profile-picture', userController.deleteUserProfilePicture);
router.put('/profile', validate(userSchemas.updateUserProfileSchema), userController.updateUserProfile);

router.get('/username/:username', validate(userSchemas.getUserByUsernameSchema), userController.getUserByUsername);
router.get('/:userId', validate(userSchemas.getUserByIdSchema), userController.getUserById);
router.put('/:userId', validate(userSchemas.updateUserSchema), userController.updateUser);
router.delete('/:userId', validate(userSchemas.deleteUserSchema), userController.deleteUser);

// Follow/Unfollow
router.post('/:userId/follow', validate(userSchemas.followUserSchema), userController.followUser);
router.delete('/:userId/follow', validate(userSchemas.followUserSchema), userController.unfollowUser);

// Profile & Relations
router.get('/:userId/profile', validate(userSchemas.getUserProfileSchema), userController.getUserProfile);
router.get('/:userId/followers', validate(userSchemas.getFollowsSchema), userController.getFollowers);
router.get('/:userId/following', validate(userSchemas.getFollowsSchema), userController.getFollowing);

export default router;
