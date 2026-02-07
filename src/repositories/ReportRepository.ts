import { pool } from '../config/pg.config.js';
import type { CreateReportParams, Report } from '@types';
import { sDebug, sError } from 'sk-logger';
import { toCamel } from '@/utils/toCamel.js';

class ReportRepository {
    async createReport(params: CreateReportParams): Promise<Report> {
        const query = `
            INSERT INTO reports (
                reporter_id, reported_user_id, target_type, target_id, report_category, description
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const values = [
            params.reporterId,
            params.reportedUserId,
            params.targetType,
            params.targetId,
            params.reportCategory,
            params.description
        ];

        try {
            const result = await pool.query(query, values);
            return toCamel(result.rows[0]);
        } catch (error) {
            sError('[ReportRepository] Error creating report:', error);
            throw error;
        }
    }

    async getReportById(reportId: string): Promise<Report | null> {
        const query = 'SELECT * FROM reports WHERE report_id = $1';
        try {
            const result = await pool.query(query, [reportId]);
            return result.rows.length > 0 ? toCamel(result.rows[0]) : null;
        } catch (error) {
            sError('[ReportRepository] Error getting report by ID:', error);
            throw error;
        }
    }
}

export default new ReportRepository();
