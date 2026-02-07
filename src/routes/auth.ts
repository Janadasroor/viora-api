import { Router } from 'express';
import authController from "../controllers/AuthController.js";
import { authenticateToken } from '../utils/authMiddleWare.js';
import { validate } from '../middleware/validation.js';
import { authSchemas } from '../validators/schemas/index.js';
import { authLimiter, verificationLimiter, passwordResetLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.post("/login", authLimiter, validate(authSchemas.loginSchema), authController.login);
router.post("/register", authLimiter, validate(authSchemas.registerSchema), authController.register);
router.post("/refresh", validate(authSchemas.refreshTokenSchema), authController.refreshToken);
router.post("/logout", validate(authSchemas.logoutSchema), authController.logout);
router.post("/request-code", verificationLimiter, validate(authSchemas.requestVerificationSchema), authController.requestVerificationCode);
router.post("/verify-code", validate(authSchemas.verifyEmailSchema), authController.verifyCode);

// Password management
router.post("/forgot-password", passwordResetLimiter, validate(authSchemas.requestPasswordResetSchema), authController.requestPasswordReset);
router.post("/reset-password", validate(authSchemas.resetPasswordSchema), authController.resetPassword);
router.post("/change-password", authenticateToken, validate(authSchemas.changePasswordSchema), authController.changePassword);

export default router;