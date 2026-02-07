import express from 'express';
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import likeQueue from '../jobs/queues/likeQueue.js';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [new BullMQAdapter(likeQueue.getQueue())],
  serverAdapter,
});
const queueMonitorRouter = serverAdapter.getRouter();
export { queueMonitorRouter };