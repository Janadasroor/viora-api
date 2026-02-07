import { Worker } from 'bullmq';
import { redisConnection } from "../index.js";
import redisService from '../../cache/RedisService.js';
import { getIO } from '../../utils/socketManager.js';
import { sDebug, sError } from 'sk-logger';

const connection = redisConnection();

async function processBroadcasts(job: any) {
    if (job.name === 'aggregate-broadcasts') {
        const pendingTargets = await redisService.getPendingBroadcasts();
        if (!pendingTargets || pendingTargets.length === 0) return;

        sDebug(` Processing ${pendingTargets.length} interaction broadcasts...`);
        const io = getIO();

        for (const target of pendingTargets) {
            try {
                const parts = target.split(':');
                if (parts.length < 2) continue;
                const [targetId, targetType] = parts;
                if (!targetId || !targetType) continue;

                const count = await redisService.getLatestBroadcastCount(targetId, targetType);

                let room = '';
                if (targetType === 'post') room = `post_${targetId}`;
                else if (targetType === 'reel') room = `reel_${targetId}`;
                else if (targetType === 'story') room = `story_${targetId}`;
                else if (targetType === 'comment') {
                    // For comments, we need to know the parent post/reel room
                    const comment = await redisService.getComment(targetId);
                    if (comment?.postId) room = `post_${comment.postId}`;
                    else {
                        const reelComment = await (redisService as any).getReelComment(targetId);
                        if (reelComment?.reelId) room = `reel_${reelComment.reelId}`;
                    }
                }

                if (room) {
                    io.to(room).emit('likeUpdate', {
                        [targetType === 'comment' ? 'commentId' : `${targetType}Id`]: targetId,
                        count,
                        isAggregated: true
                    });
                }
            } catch (err) {
                sError(`Error broadcasting for target ${target}:`, err);
            }
        }

        // Clear targets after processing
        await redisService.clearPendingBroadcasts(pendingTargets);
    }
}

const interactionBroadcastWorker = new Worker(
    'interactionBroadcastQueue',
    processBroadcasts,
    { connection, concurrency: 2 }
);

interactionBroadcastWorker.on('completed', () => {
    sDebug(' Interaction broadcast job completed');
});

interactionBroadcastWorker.on('failed', (job, err) => {
    sError(' Interaction broadcast job failed:', err);
});

export default interactionBroadcastWorker;
