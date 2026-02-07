import { Queue } from 'bullmq';
import { redisConnection } from "../index.js";
import type { MediaDeleteRequest, MediaRequest } from '@types';
const connection = redisConnection();

class MediaCleanUpQueue {
    private queue: Queue;

    constructor() {
        this.queue = new Queue('mediaCleanUpQueue', { connection });
    }
    
    getQueue() {
        return this.queue;
    }
    add(filesToDelete: string[]) {
       this.queue.add('delete-media-cash', filesToDelete);
    }
    addCleanUp(mediaDeleteRequest: MediaDeleteRequest) {
        this.queue.add('delete-media', mediaDeleteRequest);
    }
    
}

const mediaCleanUpQueue = new MediaCleanUpQueue();
export default mediaCleanUpQueue;