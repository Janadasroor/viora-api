import { Router } from 'express';
import storiesController from '../controllers/StoriesController.js';
import { validate } from '../middleware/validation.js';
import { storySchemas } from '../validators/schemas/index.js';

const router = Router();

router.post("/", validate(storySchemas.createStorySchema), storiesController.createStory);
router.get("/", validate(storySchemas.getStoriesSchema), storiesController.getStories);
router.get("/following", validate(storySchemas.getFollowingStoriesSchema), storiesController.getFollowingStories);
router.get("/:storyId", validate(storySchemas.getStoryByIdSchema), storiesController.getStoryById);
router.get("/:storyId/views", validate(storySchemas.getStoryViewsSchema), storiesController.getStoryViews);
router.put("/:storyId", validate(storySchemas.updateStorySchema), storiesController.updateStory);
router.delete("/:storyId", validate(storySchemas.deleteStorySchema), storiesController.deleteStory);

export default router;