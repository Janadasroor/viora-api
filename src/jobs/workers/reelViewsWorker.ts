import { Worker } from 'bullmq';
import redisService from '../../cache/RedisService.js';
import cassandraReelViewsRepository from '../../repositories/CassandraReelViewsRepository.js';
import { redisConnection } from "../index.js";
import { sDebug, sError } from 'sk-logger';
const connection = redisConnection();

async function processJob(job: any) {
  if (job.name === 'batch-process-all-reel-views' || job.name === 'batch-process-reel-views') {
    // Process detailed logs for Cassandra (Only source of truth now)
    sDebug(`processJob: ${job.name} - Logging to Cassandra`);
    let detailedViews = await redisService.popPendingDetailedViews(500);
    let totalProcessed = 0;

    while (detailedViews.length > 0) {
      const logs = detailedViews.map(v => ({
        ...v,
        viewedAt: new Date(v.viewedAt)
      }));
      await cassandraReelViewsRepository.batchInsertReelViews(logs);
      totalProcessed += logs.length;
      detailedViews = await redisService.popPendingDetailedViews(500);
    }

    if (totalProcessed > 0) {
      sDebug(`Successfully processed ${totalProcessed} reel views to Cassandra`);
    } else {
      sDebug(`No pending reel views found for ${job.name}`);
    }
  }
}

const reelViewsWorker = new Worker(
  'reelViewsQueue',
  async (job) => {
    await processJob(job);
  },
  { connection, concurrency: 5 }
);

reelViewsWorker.on('completed', (job) => {
  sDebug('Reel view job completed', job.data.reelId);
});

reelViewsWorker.on('failed', (job, err) => {
  sError('Reel view job failed', err);
});

export default reelViewsWorker;
