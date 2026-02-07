import type { MediaFile, VideoVariant } from "./post.types.js";

export interface Reel {
  reelId: string; // UUID
  userId: string;
  caption: string;
  mediaUrl: string;
  audioUrl?: string | null;
  trendingScore: string;
  viewsCount: string;
  likesCount: string;
  commentsCount: string;
  sharesCount: string;
  createdAt: Date;
  updatedAt: Date;
  media?: ReelMedia[];
}
export interface ReelMedia {
  reelId: string;
  mediaId: string; // UUID from media table
  filePath: string;
  mimeType: string;
  mediaType: string;
  width: number | null;
  height: number | null;
  thumbnailPath: string | null;
  thumbnailWidth: number | null;
  thumbnailHeight: number | null;
  fileName: string;
  altText: string | null;
  mediaOrder: number;
  duration: number | null;
  aspectRatio: string | null;
  codec: string | null;
  bitrate: number | null;
  fps: number | null;
  hasAudio: boolean | null;
  status: string;
  variants?: VideoVariant[] | null; // Only present for video media
}


export interface ReelWithUser extends Reel {
  username: string;
  displayName?: string;
  isVerified?: boolean;
  isFollowing?: boolean;
  bio?: string;
  followersCount?: string;
  followingCount?: string;
  userMedia?: MediaFile[];
  isLiked?: boolean;
}

export interface GetReelFeedParams {
  cursor?: string;
  limit: number;
  userId: string;
}

export interface ReelView {
  reelId: string;
  userId: string;
  createdAt: Date | string;
}
