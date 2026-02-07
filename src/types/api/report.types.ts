export interface Report {
    reportId: string;
    reporterId: string;
    reportedUserId?: string;
    targetType: 'post' | 'comment' | 'story' | 'user' | 'message' | 'group' | 'reel';
    targetId: string;
    reportCategory: 'spam' | 'harassment' | 'hate_speech' | 'violence' | 'self_harm' | 'nudity' | 'copyright' | 'impersonation' | 'scam' | 'other';
    description?: string;
    status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
    reviewedBy?: string;
    reviewedAt?: Date;
    actionTaken?: string;
    createdAt: Date;
}

export interface CreateReportParams {
    reporterId: string;
    reportedUserId?: string;
    targetType: string;
    targetId: string;
    reportCategory: string;
    description?: string;
}
