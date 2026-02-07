import express from 'express';
import analyticsService from '../services/AnalyticsService.js';
import { authenticateToken } from '../utils/authMiddleWare.js';
import { sError, sInfo } from 'sk-logger';

const router = express.Router();

/**
 * Track content watch heartbeat
 * POST /api/v1/analytics/watch
 */
router.post('/watch', authenticateToken, async (req: any, res: any) => {
    try {
        const { contentId, duration, deviceType } = req.body;
        const userId = req.user?.userId;

        if (!contentId || !duration) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Fire and forget (streamed to Redis)
        analyticsService.trackWatchHeartbeat(contentId, userId, parseInt(duration), deviceType);

        return res.status(200).json({ success: true });
    } catch (error) {
        sError('Analytics watch error:', error);
        return res.status(500).json({ success: false });
    }
});

/**
 * Track user heartbeat (app usage or content watch)
 * POST /api/v1/analytics/heartbeat
 */
router.post('/heartbeat', authenticateToken, async (req: any, res: any) => {
    try {
        const { duration, type } = req.body;
        const userId = req.user?.userId;

        if (!duration || !type || !['active_time', 'watch_time'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Invalid or missing fields' });
        }

        await analyticsService.trackHeartbeat(userId, type, parseInt(duration));
        return res.status(200).json({ success: true });
    } catch (error) {
        sError('Heartbeat tracking error:', error);
        return res.status(500).json({ success: false });
    }
});

/**
 * Get current user's usage statistics for today
 * GET /api/v1/analytics/usage
 */
router.get('/usage', authenticateToken, async (req: any, res: any) => {
    try {
        const userId = req.user?.userId;
        const usage = await analyticsService.getUserUsage(userId);
        return res.status(200).json({ success: true, data: usage });
    } catch (error) {
        sError('Get usage stats error:', error);
        return res.status(500).json({ success: false });
    }
});

/**
 * Get profile analytics (Dashboard)
 * GET /api/v1/analytics/profile/:profileId
 */
router.get('/profile/:userId', authenticateToken, async (req: any, res: any) => {
    try {
        const requesterId = req.params.userId;
        const { days = 7 } = req.query;
        const userId = req.user?.userId;

        // Security: only the profile owner or admins can see detailed analytics
        if (userId !== requesterId) {
            sInfo('Access denied for user:', userId, 'requester:', requesterId);
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const stats = await analyticsService.getProfileStats(requesterId, parseInt(days as string));
        return res.status(200).json({ success: true, data: stats });
    } catch (error) {
        sError('Get profile stats error:', error);
        return res.status(500).json({ success: false });
    }
});

export default router;
