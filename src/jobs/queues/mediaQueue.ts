import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";
import type { MediaRequest } from '@types';
const connection = redisConnection();

class MediaQueue {
    private queue: Queue;

    constructor() {
        this.queue = new Queue('mediaQueue', { connection });
    }
    
    getQueue() {
        return this.queue;
    }
    add(mediaRequest: MediaRequest) {
        this.queue.add('image-processing', mediaRequest);
        this.queue.add('video-processing', mediaRequest);
    }
    
}

const mediaQueue = new MediaQueue();
export default mediaQueue;