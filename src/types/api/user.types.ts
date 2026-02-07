import type { MediaFile } from "./post.types.js";

export interface User {
  userId: string;
  username: string;
  isOnline: boolean;
  email: string;
  emailVerified?: boolean;
  accountStatus?: string;
  createdAt: Date;
  lastLoginAt?: Date;
}

export interface UserProfile {
  userId: string;

  displayName: string;
  bio?: string;
  media?: MediaFile[];
  website?: string;
  location?: string;
  isPrivate: boolean;
  isVerified: boolean;
  followersCount: string;
  followingCount: string;
  postsCount: string;
  gender?: string;
  birthDate?: Date;
  safeMode: number;
  updatedAt: Date;
  createdAt: Date;
}
export interface UserWithProfile extends User {
  displayName: string;
  bio?: string;
  media?: MediaFile[];
  website?: string;
  location?: string;
  isPrivate: boolean;
  isVerified: boolean;
  followersCount: string;
  followingCount: string;
  postsCount: string;
  isFollowing?: boolean;
  isBlockedByUser?: boolean;
  isBlockingUser?: boolean;
}

export interface ProfileUpdateData {
  displayName?: string | undefined;
  bio?: string | undefined;
  website?: string | null;
  location?: string | null;
  isPrivate?: boolean | undefined;
  gender?: string | undefined;
  birthDate?: Date | string | undefined;
  safeMode?: number | undefined;
}

export interface UserFilters {
  page?: number;
  limit?: number;
  search?: string;
  verified?: string | boolean;
  status?: string;
}

export interface Follow {
  followerId: string;
  followingId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileWithFollow extends UserProfile {
  isFollowing: boolean;
  isFollower: boolean;
}
