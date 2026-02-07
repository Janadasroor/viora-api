import type { MediaFile } from "./post.types.js";


export interface FeedPost {
  postId: string;
  userId: string; // bigint
  caption: string | null;
  postType: string;
  visibility: string;
  location: string | null;
  likesCount: string;
  commentsCount: string;
  sharesCount: string;
  viewsCount: string;
  createdAt: string;

  // User information
  username: string;
  displayName: string | null;
  userMedia?: MediaFile[];
  isVerified: boolean;
  isOnline: boolean;

  // User interaction flags
  userLiked: boolean;
  userSaved: boolean;

  // Content
  hashtags: string | null;
  media: MediaFile[]; // Array of media from media table

  // Metadata
  feedMetadata: Record<string, unknown> | null;
}

export interface FeedResponse {
  posts: FeedPost[];
  hasMore: boolean;
}

export interface TrendingHashtagSamplePost {
  postId: string;
  mediaUrl: string | null;
}

export interface TrendingHashtagItem {
  hashtagId: string;
  tagName: string;
  totalPosts: string;
  recentPosts: string;
  totalEngagement: string;
  postsPerHour: string;
  samplePosts: TrendingHashtagSamplePost[] | null;
}

export interface TrendingHashtagsResponse {
  hashtags: TrendingHashtagItem[];
  hasMore: boolean;
}

// Optional: Simplified version for feed display
export interface FeedMediaItem {
  id: string; // UUID
  type: string; // 'image' | 'video'
  originalPath: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  aspectRatio: string | null;
  duration: number | null; // for videos
  hasAudio: boolean;
  title: string | null;
  description: string | null;
}