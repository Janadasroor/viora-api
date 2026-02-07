import { Router } from "express";
import commentsController from "../controllers/CommentsController.js";
import { validate } from '../middleware/validation.js';
import { commentSchemas } from '../validators/schemas/index.js';

const router = Router();

router.get('/:targetId', validate(commentSchemas.getCommentsSchema), commentsController.getComments);
router.post('/posts/:postId/comments', validate(commentSchemas.createPostCommentSchema), commentsController.createComment);
router.post('/reels/:reelId/comments', validate(commentSchemas.createReelCommentSchema), commentsController.commentReel);
router.delete('/reels/comments/:commentId', validate(commentSchemas.deleteCommentSchema), commentsController.deleteReelComment.bind(commentsController));
router.get('/:commentId/replies', validate(commentSchemas.getCommentRepliesSchema), commentsController.getCommentReplies.bind(commentsController));
router.put('/:commentId', validate(commentSchemas.updateCommentSchema), commentsController.updateComment.bind(commentsController));
router.delete('/:commentId', validate(commentSchemas.deleteCommentSchema), commentsController.deleteComment.bind(commentsController));

export default router;