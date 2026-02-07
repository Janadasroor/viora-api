import { Worker } from "bullmq";
import type { InsertComment } from "@types";
import commentsRepository from "../../repositories/CommentsRepository.js";
import redisService from "../../cache/RedisService.js";
import { redisConnection } from "../index.js";
import notificationsService from "../../services/NotificationsService.js";
import postsRepository from "../../repositories/PostsRepository.js";
import reelRepository from "../../repositories/ReelRepository.js";
import userRepository from "../../repositories/UserRepository.js";
import storiesRepository from "../../repositories/StoriesRepository.js";
import { extractMentions } from "../../utils/mentions.js";
import { sDebug, sError, sInfo } from "sk-logger";
const connection = redisConnection();

sDebug("Initializing comments worker with connection config:", { host: connection.host, port: connection.port });

export async function processCommentsJob(job: any) {
  sDebug(`[CommentsWorker] Processing job: ${job.name} (ID: ${job.id})`, job.data);
  if (job.name === "batch-process-all-comments") {
    // Get all posts with pending comments
    const postIds = await redisService.getAllPostsWithPendingComments();
    if (postIds.length === 0 || !postIds) return;
    for (let i = 0; i < postIds.length; i++) {
      const postId = postIds[i];
      if (!postId) continue;
      const comments = await redisService.getAccumulatedComments(postId);

      if (comments.length > 0) {
        sDebug(`Processing ${comments.length} comments for post ${postId}`);

        const commentsToInsert = comments
          .filter(c => c.commentId && c.userId && (c.postId || postId) && c.content)
          .map(c => ({
            commentId: c.commentId,
            userId: c.userId!,
            targetId: c.postId! || postId,
            content: c.content!,
            createdAt: c.createdAt || new Date(),
            updatedAt: c.updatedAt || new Date(),
            parentCommentId: c.parentCommentId || null
          })) as InsertComment[];

        await commentsRepository.bulkInsertPostComments(commentsToInsert);
        await redisService.clearProcessedComments(postId);

        // Buffer notifications and mentions together to reduce loops
        try {
          if (!postId) continue;
          const postOwner = await postsRepository.getPostOwner(postId);
          if (postOwner) {
            // 1. Aggregated notifications for post owner
            const uniqueCommenters = [...new Set(
              comments
                .filter(c => !c.parentCommentId && c.userId !== postOwner.userId)
                .map(c => c.userId)
            )];

            for (const actorId of uniqueCommenters) {
              await notificationsService.notify({
                recipientId: postOwner.userId,
                actorId,
                notificationType: 'comment',
                targetType: 'post',
                targetId: postId,
                useAggregation: true
              });
            }

            // 2. Replies and Mentions (can do in parallel for current post)
            const notificationPromises: Promise<any>[] = [];
            for (const comment of comments) {
              // Replies
              if (comment.parentCommentId) {
                notificationPromises.push((async () => {
                  const parentCommentOwner = await commentsRepository.getCommentOwner(comment.parentCommentId!);
                  if (parentCommentOwner && parentCommentOwner.userId !== comment.userId) {
                    await notificationsService.notify({
                      recipientId: parentCommentOwner.userId,
                      actorId: comment.userId,
                      notificationType: 'comment',
                      targetType: 'comment',
                      targetId: comment.parentCommentId!,
                      message: 'replied to your comment',
                      sendPush: true
                    });
                  }
                })());
              }

              // Mentions
              const mentionedUsernames = extractMentions(comment.content);
              if (mentionedUsernames.length > 0) {
                notificationPromises.push((async () => {
                  const mentionedUsers = await userRepository.getUsersByUsernames(mentionedUsernames);
                  for (const mentionedUser of mentionedUsers) {
                    if (mentionedUser.userId !== comment.userId) {
                      await notificationsService.notify({
                        recipientId: mentionedUser.userId,
                        actorId: comment.userId,
                        notificationType: 'mention',
                        targetType: 'comment',
                        targetId: comment.commentId,
                        message: 'mentioned you in a comment',
                        sendPush: true
                      });
                    }
                  }
                })());
              }
            }
            if (notificationPromises.length > 0) {
              await Promise.all(notificationPromises);
            }
          }
        } catch (notifError) {
          sError(`Failed to process notifications for post ${postId}:`, notifError);
        }
      }
      // Update progress every 10 posts or at the end
      if (i % 10 === 0 || i === postIds.length - 1) {
        await job.updateProgress(Math.floor((i / postIds.length) * 100));
      }
    }


  }

  if (job.name === "batch-process-comment") {
    const { commentId } = job.data;
    sDebug(`Processing comment  for ${commentId}`);
    const comment = await redisService.getComment(commentId);

    if (!comment?.postId || !comment?.userId) return;
    await commentsRepository.insertComment({
      postId: comment.postId,
      userId: comment.userId,
      parentCommentId: comment.parentCommentId || null,
      content: comment.content || "",
      commentId: commentId,
    });
    sDebug(`Processing single comment ${commentId}`);

    // Send notification
    try {
      const postOwner = await postsRepository.getPostOwner(comment.postId);
      if (postOwner && postOwner.userId !== comment.userId) {
        if (comment.parentCommentId) {
          const parentCommentOwner = await commentsRepository.getCommentOwner(comment.parentCommentId);
          if (parentCommentOwner && parentCommentOwner.userId !== comment.userId) {
            await notificationsService.notify({
              recipientId: parentCommentOwner.userId,
              actorId: comment.userId,
              notificationType: 'comment',
              targetType: 'comment',
              targetId: comment.parentCommentId,
              message: 'replied to your comment',
              sendPush: true
            });
          }
        } else {
          await notificationsService.notify({
            recipientId: postOwner.userId,
            actorId: comment.userId,
            notificationType: 'comment',
            targetType: 'post',
            targetId: comment.postId,
            message: 'commented on your post',
            sendPush: true
          });
        }
      }
    } catch (notifError) {
      sError(`Failed to send notification for comment ${commentId}:`, notifError);
    }

    // Handle mentions for single comment
    try {
      const mentionedUsernames = extractMentions(comment.content || "");
      if (mentionedUsernames.length > 0) {
        const mentionedUsers = await userRepository.getUsersByUsernames(mentionedUsernames);

        for (const mentionedUser of mentionedUsers) {
          if (mentionedUser.userId === comment.userId) continue;

          await notificationsService.notify({
            recipientId: mentionedUser.userId,
            actorId: comment.userId,
            notificationType: 'mention',
            targetType: 'comment',
            targetId: commentId,
            message: 'mentioned you in a comment',
            sendPush: true
          });
        }
      }
    } catch (mentionError) {
      sError(`Failed to process mentions for single comment ${commentId}:`, mentionError);
    }

  }
  if (job.name == "batch-process-delete-all-comments") {
    // Get all posts with pending comments
    const postIds = await redisService.getAllPostsWithPendingComments();
    if (postIds.length === 0 || !postIds) return;
    for (const postId of postIds) {
      const comments = await redisService.getAccumulatedComments(postId);

      if (comments.length > 0) {
        sDebug(`Processing ${comments.length} comments for post ${postId}`);
        sDebug(`Processing comments A for post ${comments[0]?.postId} `);

        const commentsToInsert = comments.map(c => ({
          commentId: c.commentId,
          userId: c.userId,
          targetId: c.postId,
          content: c.content,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt
        }));

        await commentsRepository.bulkInsertPostComments(commentsToInsert);
        await redisService.clearProcessedComments(postId);
      }
    }

  }
  if (job.name == "batch-process-delete-comment") {
    const { commentId } = job.data;
    await commentsRepository.deleteComment(commentId);
  }

  if (job.name === "batch-process-all-reel-comments") {
    // Get all reels with pending comments
    const reelIds = await redisService.getAllReelsWithPendingComments();
    if (reelIds.length === 0 || !reelIds) return;
    for (let i = 0; i < reelIds.length; i++) {
      const reelId = reelIds[i];
      if (!reelId) continue;
      const comments = await redisService.getAccumulatedReelComments(reelId);

      if (comments.length > 0) {
        sDebug(`Processing ${comments.length} comments for reel ${reelId}`);

        const commentsToInsert = comments
          .filter(c => c.commentId && c.userId && (c.reelId || reelId) && c.content)
          .map(c => ({
            commentId: c.commentId,
            userId: c.userId!,
            targetId: c.reelId! || reelId,
            content: c.content!,
            createdAt: c.createdAt || new Date(),
            updatedAt: c.updatedAt || new Date(),
            parentCommentId: c.parentCommentId || null
          })) as InsertComment[];

        await commentsRepository.bulkInsertReelComments(commentsToInsert);
        await redisService.clearProcessedReelComments(reelId);

        // Buffer notifications and mentions together
        try {
          const reelOwner = await reelRepository.getReelOwner(reelId);
          if (reelOwner) {
            // 1. Aggregated notifications for reel owner
            const uniqueCommenters = [...new Set(
              comments
                .filter(c => !c.parentCommentId && c.userId !== reelOwner.userId)
                .map(c => c.userId)
            )];

            for (const actorId of uniqueCommenters) {
              await notificationsService.notify({
                recipientId: reelOwner.userId,
                actorId,
                notificationType: 'comment',
                targetType: 'reel',
                targetId: reelId,
                useAggregation: true
              });
            }

            // 2. Replies and Mentions (parallel)
            const notificationPromises: Promise<any>[] = [];
            for (const comment of comments) {
              if (comment.parentCommentId) {
                notificationPromises.push((async () => {
                  const parentCommentOwner = await commentsRepository.getCommentOwner(comment.parentCommentId!);
                  if (parentCommentOwner && parentCommentOwner.userId !== comment.userId) {
                    await notificationsService.notify({
                      recipientId: parentCommentOwner.userId,
                      actorId: comment.userId,
                      notificationType: 'comment',
                      targetType: 'comment',
                      targetId: comment.parentCommentId!,
                      message: 'replied to your comment',
                      sendPush: true
                    });
                  }
                })());
              }

              const mentionedUsernames = extractMentions(comment.content);
              if (mentionedUsernames.length > 0) {
                notificationPromises.push((async () => {
                  const mentionedUsers = await userRepository.getUsersByUsernames(mentionedUsernames);
                  for (const mentionedUser of mentionedUsers) {
                    if (mentionedUser.userId !== comment.userId) {
                      await notificationsService.notify({
                        recipientId: mentionedUser.userId,
                        actorId: comment.userId,
                        notificationType: 'mention',
                        targetType: 'comment',
                        targetId: comment.commentId,
                        message: 'mentioned you in a comment',
                        sendPush: true
                      });
                    }
                  }
                })());
              }
            }
            if (notificationPromises.length > 0) await Promise.all(notificationPromises);
          }
        } catch (notifError) {
          sError(`Failed to process notifications for reel ${reelId}:`, notifError);
        }
      }
      if (i % 10 === 0 || i === reelIds.length - 1) {
        await job.updateProgress(Math.floor((i / reelIds.length) * 100));
      }
    }
  }

  if (job.name === "batch-process-reel-comment") {
    const { commentId } = job.data;
    const comment = await redisService.getReelComment(commentId);

    if (!comment?.reelId || !comment?.userId) return;

    // Use insertReelComment from repository
    await commentsRepository.insertReelComment(
      comment.userId,
      comment.reelId,
      comment.content || "",
      comment.parentCommentId || null,
      commentId
    );
    sDebug(`Processing single reel comment ${commentId}`);

    // Send notification
    try {
      const reelOwner = await reelRepository.getReelOwner(comment.reelId);
      if (reelOwner && reelOwner.userId !== comment.userId) {
        if (comment.parentCommentId) {
          const parentCommentOwner = await commentsRepository.getCommentOwner(comment.parentCommentId);
          if (parentCommentOwner && parentCommentOwner.userId !== comment.userId) {
            await notificationsService.notify({
              recipientId: parentCommentOwner.userId,
              actorId: comment.userId,
              notificationType: 'comment',
              targetType: 'comment',
              targetId: comment.parentCommentId,
              message: 'replied to your comment',
              sendPush: true
            });
          }
        } else {
          await notificationsService.notify({
            recipientId: reelOwner.userId,
            actorId: comment.userId,
            notificationType: 'comment',
            targetType: 'reel',
            targetId: comment.reelId,
            message: 'commented on your reel',
            sendPush: true
          });
        }
      }
    } catch (notifError) {
      sError(`Failed to send notification for reel comment ${commentId}:`, notifError);
    }

    // Handle mentions for single reel comment
    try {
      const mentionedUsernames = extractMentions(comment.content || "");
      if (mentionedUsernames.length > 0) {
        const mentionedUsers = await userRepository.getUsersByUsernames(mentionedUsernames);

        for (const mentionedUser of mentionedUsers) {
          if (mentionedUser.userId === comment.userId) continue;

          await notificationsService.notify({
            recipientId: mentionedUser.userId,
            actorId: comment.userId,
            notificationType: 'mention',
            targetType: 'comment', // Link to the comment
            targetId: commentId,
            message: 'mentioned you in a comment',
            sendPush: true
          });
        }
      }
    } catch (mentionError) {
      sError(`Failed to process mentions for single reel comment ${commentId}:`, mentionError);
    }
  }

  if (job.name === "batch-process-all-story-comments") {
    const storyIds = await redisService.getAllStoriesWithPendingComments();
    if (storyIds.length === 0 || !storyIds) return;

    for (let i = 0; i < storyIds.length; i++) {
      const storyId = storyIds[i];
      if (!storyId) continue;
      const comments = await redisService.getAccumulatedStoryComments(storyId);
      if (comments.length > 0) {
        sDebug(`Processing ${comments.length} comments for story ${storyId}`);

        const commentsToInsert = comments
          .filter(c => c.commentId && c.userId && (c.storyId || storyId) && c.content)
          .map(c => ({
            commentId: c.commentId,
            userId: c.userId!,
            targetId: c.storyId! || storyId,
            content: c.content!,
            createdAt: c.createdAt || new Date(),
            updatedAt: c.updatedAt || new Date(),
            parentCommentId: c.parentCommentId || null
          })) as InsertComment[];

        await commentsRepository.bulkInsertStoryComments(commentsToInsert);
        await redisService.clearProcessedStoryComments(storyId);

        // Notifications
        try {
          const storyOwner = await storiesRepository.getStoryOwner(storyId);
          if (storyOwner) {
            const uniqueCommenters = [...new Set(
              comments
                .filter(c => !c.parentCommentId && c.userId !== storyOwner.userId)
                .map(c => c.userId)
            )];

            for (const actorId of uniqueCommenters) {
              await notificationsService.notify({
                recipientId: storyOwner.userId,
                actorId,
                notificationType: 'comment',
                targetType: 'story',
                targetId: storyId,
                useAggregation: true
              });
            }

            const notificationPromises: Promise<any>[] = [];
            for (const comment of comments) {
              if (comment.parentCommentId) {
                notificationPromises.push((async () => {
                  const parentCommentOwner = await commentsRepository.getCommentOwner(comment.parentCommentId!);
                  if (parentCommentOwner && parentCommentOwner.userId !== comment.userId) {
                    await notificationsService.notify({
                      recipientId: parentCommentOwner.userId,
                      actorId: comment.userId,
                      notificationType: 'comment',
                      targetType: 'comment',
                      targetId: comment.parentCommentId!,
                      message: 'replied to your comment',
                      sendPush: true
                    });
                  }
                })());
              }

              // Mentions
              const mentionedUsernames = extractMentions(comment.content);
              if (mentionedUsernames.length > 0) {
                notificationPromises.push((async () => {
                  const mentionedUsers = await userRepository.getUsersByUsernames(mentionedUsernames);
                  for (const mentionedUser of mentionedUsers) {
                    if (mentionedUser.userId !== comment.userId) {
                      await notificationsService.notify({
                        recipientId: mentionedUser.userId,
                        actorId: comment.userId,
                        notificationType: 'mention',
                        targetType: 'comment',
                        targetId: comment.commentId,
                        message: 'mentioned you in a comment',
                        sendPush: true
                      });
                    }
                  }
                })());
              }
            }
            if (notificationPromises.length > 0) await Promise.all(notificationPromises);
          }
        } catch (notifError) {
          sError(`Failed to process notifications for story ${storyId}:`, notifError);
        }
      }
      if (i % 10 === 0 || i === storyIds.length - 1) {
        await job.updateProgress(Math.floor((i / storyIds.length) * 100));
      }
    }
  }

  if (job.name === "batch-process-story-comment") {
    const { commentId } = job.data;
    const comment = await redisService.getStoryComment(commentId);
    if (!comment?.storyId || !comment?.userId) return;

    await commentsRepository.bulkInsertStoryComments([{
      commentId: comment.commentId,
      userId: comment.userId,
      targetId: comment.storyId!,
      content: comment.content!,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      parentCommentId: comment.parentCommentId || null
    }]);
    sDebug(`Processing single story comment ${commentId}`);

    // Notification
    try {
      const storyOwner = await storiesRepository.getStoryOwner(comment.storyId);
      if (storyOwner && storyOwner.userId !== comment.userId) {
        if (comment.parentCommentId) {
          const parentCommentOwner = await commentsRepository.getCommentOwner(comment.parentCommentId);
          if (parentCommentOwner && parentCommentOwner.userId !== comment.userId) {
            await notificationsService.notify({
              recipientId: parentCommentOwner.userId,
              actorId: comment.userId,
              notificationType: 'comment',
              targetType: 'comment',
              targetId: comment.parentCommentId,
              message: 'replied to your comment',
              sendPush: true
            });
          }
        } else {
          await notificationsService.notify({
            recipientId: storyOwner.userId,
            actorId: comment.userId,
            notificationType: 'comment',
            targetType: 'story',
            targetId: comment.storyId,
            message: 'commented on your story',
            sendPush: true
          });
        }
      }
    } catch (notifError) {
      sError(`Failed to send notification for story comment ${commentId}:`, notifError);
    }
  }
}

let worker: Worker | undefined;

if (process.env.NODE_ENV !== "test") {
  worker = new Worker(
    "commentQueue",
    async (job) => {
      await processCommentsJob(job);
    },
    {
      connection,
      concurrency: 5,
      lockDuration: 300000, // 5 minutes
      maxStalledCount: 1, // Minimize multiple workers picking up stalled jobs
    }
  );
  sInfo("Comments worker started");
}

export default worker;
