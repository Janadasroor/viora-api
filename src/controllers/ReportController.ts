import type { Request, Response } from 'express';
import reportService from '../services/ReportService.js';
import { sError } from 'sk-logger';

class ReportController {
    async createReport(req: Request, res: Response) {
        try {
            const { reportedUserId, targetType, targetId, reportCategory, description } = req.body;
            const reporterId = req.user?.userId;

            if (!reporterId) {
                return res.status(401).json({ message: 'Unauthorized' });
            }

            if (!targetType || !targetId || !reportCategory) {
                return res.status(400).json({ message: 'Missing required fields' });
            }

            const report = await reportService.reportContent({
                reporterId,
                reportedUserId,
                targetType,
                targetId,
                reportCategory,
                description
            });

            return res.status(201).json({
                message: 'Report submitted successfully',
                report
            });
        } catch (error) {
            sError('[ReportController] Error creating report:', error);
            return res.status(500).json({ message: 'Failed to submit report' });
        }
    }
}

export default new ReportController();
