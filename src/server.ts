import 'dotenv/config';
import { exec } from 'child_process';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import http from 'http';
import type { Socket } from 'socket.io';
import cookieParser from 'cookie-parser';
// Import workers
import './jobs/workers/interactionsWorker.js';
import './jobs/workers/commentsWorker.js';
import './jobs/workers/mediaWorker.js';
import './jobs/workers/mediaCleanupWorker.js';
import './jobs/workers/notificationAggregationWorker.js';
import './jobs/workers/postsWorker.js';
import './jobs/workers/reelViewsWorker.js';
import './jobs/workers/interactionBroadcastWorker.js';
import './jobs/workers/storyViewsWorker.js';
import { initSocketIO } from './utils/socketManager.js';
import { queueMonitorRouter } from './monitors/queueMonitor.js';
import { connectCassandra } from './config/cassandra.config.js';

// Initialize Cassandra
connectCassandra();

// ============================================================================
// Route Imports
// ============================================================================
import apiRouter from './routes/api.js';
import type { AuthenticatedRequest, CustomJwtPayload } from '@types';
import { sLog, initLogger, getAdminPanelPath, setupAdminPanel, sError, sDebug, sInfo, metricsMiddleware } from 'sk-logger';
import { toCamel } from './utils/toCamel.js';
//Create directories
import "./init.js";
import pkg from '../package.json' with { type: "json" };
import { authenticateToken } from './utils/authMiddleWare.js';

const VIORA_VERSION = "1.0.0";

const API_PREFIX = `/api/${VIORA_VERSION}`;

interface SocketWithUserId extends Socket {
  userId?: string;
}
// Constants
const port = process.env.PORT ? parseInt(process.env.PORT) : 3003;

const app = express();
const server = http.createServer(app);
const io = initSocketIO(server);

//Logger
import { queueStatsCollector } from 'sk-logger/dist/queueStats.js';
import { sessionTracker } from 'sk-logger/dist/sessionTracker.js';
import likeQueue from './jobs/queues/likeQueue.js';
import commentLikeQueue from './jobs/queues/commentLikeQueue.js';
import reelLikeQueue from './jobs/queues/reelLikeQueue.js';
import storyLikeQueue from './jobs/queues/storyLikeQueue.js';
import mediaQueue from './jobs/queues/mediaQueue.js';
import { postsQueue } from './jobs/queues/postsQueue.js';
import mediaCleanupQueue from './jobs/queues/mediaCleanupQueue.js';
import notificationAggregationQueue from './jobs/queues/notificationAggregationQueue.js';
import { feedPrecomputeQueue } from './jobs/queues/feedPrecomputeQueue.js';
import { commentsQueue } from './jobs/queues/commentsQueue.js';
import analyticsQueue from './jobs/queues/analyticsQueue.js';
import interactionBroadcastQueue from './jobs/queues/interactionBroadcastQueue.js';
import storyViewsQueue from './jobs/queues/storyViewsQueue.js';
import { socketHandler } from './sockets/socketHandler.js';
import redisService from './cache/RedisService.js';

// =====================
// Health & Test Routes
// =====================
app.get('/health', async (req: Request, res: Response) => {
  return res.json({ status: 'Server is running', timestamp: new Date() });
});
import redisClient from './config/redis.config.js';

// Register all queues with the stats collector
queueStatsCollector.registerQueues({
  'likes': likeQueue.getQueue(),
  'comment-likes': commentLikeQueue.getQueue(),
  'reel-likes': reelLikeQueue.getQueue(),
  'story-likes': storyLikeQueue.getQueue(),
  'media-processing': mediaQueue.getQueue(),
  'post-processing': postsQueue,
  'media-cleanup': mediaCleanupQueue.getQueue(),
  'notifications': notificationAggregationQueue.getQueue(),
  'feed-precompute': feedPrecomputeQueue,
  'analytics': analyticsQueue.getQueue(),
  'interaction-broadcasts': interactionBroadcastQueue.getQueue(),
  'story-views': storyViewsQueue.getQueue()
});

// Configure session tracker with existing Redis client
sessionTracker.setRedis(redisClient);
//Test connection
redisClient.ping().then(() => {
  sLog(' Redis connection test passed');
}).catch((err) => {
  sError(' Redis connection test failed', err);
});
initLogger(
  {
    io: io,
    enableConsole: true,
    enableError: true,
    enableDebug: true,
    enableInfo: true,
    enableWarn: true,
    kill: false,//process.env.NODE_ENV == "production",
    queueStatsCollector: queueStatsCollector,
    sessionTracker: sessionTracker,
    //skipFiles: [],
    skipFunctions: ["checkAccountStatus"]
  }
);

// Middleware
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true,
}));


app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.static(path.join(process.cwd(), 'uploads')));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
app.use(express.json());
app.use(metricsMiddleware);

setupAdminPanel(app, express);

app.use(API_PREFIX, apiRouter);
app.use('/admin/queues', queueMonitorRouter);


// =======
// Server Version
// =======
app.get('/api/version', (req: Request, res: Response) => {
  res.json({ version: pkg.version });
});


// Socket.IO Connection
io.on('connection', (socket: SocketWithUserId) => {
  sLog(`🔌 User connected: ${socket.id}`);
  socketHandler(io, socket);
  sLog(`UserID: ${socket.userId}`);

  // Admin Log Room
  socket.on('join-admin-logs', () => {
    socket.join('admin-logs');
    sLog(`Socket ${socket.id} joined admin-logs`);
  });
});


// Start server
server.listen(port, "0.0.0.0", () => {
  sLog(`server started at ${port}`);

  // Open admin dashboard automatically in dev mode
  if (process.env.NODE_ENV !== 'production') {
    const adminUrl = `http://localhost:${port}/admin/logs`;
    sLog(`Opening admin dashboard at ${adminUrl}`);
    exec(`xdg-open ${adminUrl}`, (err) => {
      if (err) sError(` Failed to open browser: ${err.message}`);
    });
  }

  // Lazy Embedding Mode Scheduler
  let isExtracting = false;
  if (process.env.LAZY_EMBEDDING_MODE === 'true') {
    sInfo('Lazy Embedding Mode active. Scheduling periodic extraction (every 1 hour).');
    const ONE_HOUR = 60 * 60 * 1000;
    setInterval(async () => {
      if (isExtracting) return;
      isExtracting = true;
      try {
        sInfo('Running scheduled lazy embedding extraction...');
        // @ts-ignore - dynamic import of script
        const { main } = await import('./scripts/extractEmbeddings.js');
        await main();
        sInfo('Scheduled lazy embedding extraction complete.');
      } catch (err) {
        sError('Error in scheduled lazy embedding extraction:', err);
      } finally {
        isExtracting = false;
      }
    }, ONE_HOUR);
  }
});