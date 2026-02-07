import type { MediaFile } from "./post.types.js";

export interface Comment {
  commentId: string;
  parentCommentId?: string;
  userId: string;
  targetId: string;
  content: string;
  likesCount: string;
  repliesCount: string;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  username: string;
  isOnline: boolean;
  displayName: string;
  userMedia?: MediaFile[];
  isVerified: boolean;
  userLiked: boolean;
  replies?: Reply[];
}

export interface Reply {
  commentId: string;
  parentCommentId: string;
  updatedAt: Date;
  content: string;
  likesCount: string;
  createdAt: Date;
  username: string;
  isOnline: boolean;
  userId: string;
  displayName: string;
  userMedia?: MediaFile[];
  isVerified: boolean;
  userLiked?: boolean;
}

export interface ReelComment {
  commentId: string;
  reelId: string;
  userId: string;
  commentText: string;
  parentCommentId: string | null;
  username: string;
  userMedia?: MediaFile[];
  createdAt: Date;
}

export interface InsertComment {
  commentId: string;
  userId: string;
  targetId: string;
  content: string;
  createdAt: Date;
  updatedAt?: Date;
  parentCommentId?: string | null;
}

export interface PostOwner {
  userId: string;
}

export interface CommentOwner {
  userId: string;
}

export interface CommentData {
  commentId: string;
  userId: string;
  postId: string;
  parentCommentId: string | null;
  content: string;
  createdAt: Date;
}
export interface CashedComment {
  commentId: string;
  userId: string;
  postId: string;
  parentCommentId: string | null;
  content: string;
  createdAt: Date;
}