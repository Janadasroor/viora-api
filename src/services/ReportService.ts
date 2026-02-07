import reportRepository from '../repositories/ReportRepository.js';
import type { CreateReportParams, Report } from '@types';
import { sDebug } from 'sk-logger';

class ReportService {
    async reportContent(params: CreateReportParams): Promise<Report> {
        sDebug(`[ReportService] Creating report for ${params.targetType} ${params.targetId} by user ${params.reporterId}`);
        return await reportRepository.createReport(params);
    }
}

export default new ReportService();
