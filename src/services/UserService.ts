import userRepository from '../repositories/UserRepository.js';
import { toCamel } from '../utils/toCamel.js';
import mediaQueue from '../jobs/queues/mediaQueue.js';
import type { PoolClient } from 'pg';
import type { MediaDeleteRequest, ProfileUpdateData } from '@types';
import { sInfo } from 'sk-logger';
import mediaCleanUpQueue from '@/jobs/queues/mediaCleanupQueue.js';
import redisClient from '../config/redis.config.js';

const PROFILE_TTL = 3600; // 1 hour


interface UsernameAvailabilityResult {
  available: boolean;
  message: string;
}

interface MessageResponse {
  message: string;
}


interface CompleteProfileData {
  displayName: string;
  bio?: string;
  location?: string;
  gender?: string;
  birthDate?: string;
  website?: string;
}

interface UserFilters {
  page?: number;
  limit?: number;
  [key: string]: any;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface UsersResponse {
  users: any[];
  pagination: Pagination;
}

interface FollowResponse {
  message: string;
  status: 'pending' | 'accepted';
}

class UserService {
  /**
   * Check if username is available
   */
  async checkUsernameAvailability(username: string): Promise<UsernameAvailabilityResult> {
    if (!username) {
      throw new Error('Username is required');
    }

    const exists = await userRepository.checkUsernameExists(username);
    return {
      available: !exists,
      message: exists ? 'Username is taken' : 'Username is available'
    };
  }

  /**
   * Update user profile picture
   * Queues media processing job for the uploaded image
   */
  async updateProfilePicture(userId: string, images: any[]): Promise<MessageResponse> {
    if (!images || images.length === 0) {
      throw new Error('Image file is required');
    }

    // Queue the image processing job
    // The media worker will process the image and update user_media table
    const mediaRequest = {
      userId: userId,
      targetType: 'USER' as const,
      targetId: userId,
      images: images,
      videos: []
    };

    await mediaQueue.add(mediaRequest);

    // Invalidate user profile cache
    await redisClient.del(`user:profile:${userId}`);

    return { message: 'Profile picture is being processed' };
  }

  /**
   * Delete user profile picture
   */
  async deleteProfilePicture(userId: string): Promise<MessageResponse> {
    // Soft delete the post
    // await postsRepository.deletePost(client, postId);
    mediaCleanUpQueue.addCleanUp({
      targetId: userId,
      targetType: 'USER'
    } as MediaDeleteRequest);

    // Invalidate cache
    await redisClient.del(`user:profile:${userId}`);

    return { message: 'Profile picture deleted successfully' };
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId: string, profileData: ProfileUpdateData): Promise<MessageResponse> {
    const {
      displayName,
      bio,
      website,
      location,
      isPrivate,
      gender,
      birthDate
    } = profileData;

    // Prepare data for update
    const updateData: ProfileUpdateData = {
      displayName: displayName,
      bio: bio,
      website: website ?? null,
      location: location ?? null,
      isPrivate: isPrivate,
      gender: gender,
      birthDate: birthDate
    };

    const updatedProfile = await userRepository.updateProfile(userId, updateData);

    if (!updatedProfile) {
      throw new Error('User profile not found');
    }

    // Invalidate cache
    await redisClient.del(`user:profile:${userId}`);

    return { message: 'Profile updated successfully' };
  }

  /**
   * Complete user profile (first-time setup)
   */
  async completeUserProfile(userId: string, profileData: CompleteProfileData): Promise<MessageResponse> {
    const { displayName, bio, location, gender, birthDate, website } = profileData;

    if (!displayName) {
      throw new Error('Display name is required');
    }

    const updateData: ProfileUpdateData = {
      displayName: displayName,
      bio: bio ?? undefined,
      location: location ?? null,
      gender: gender ?? undefined,
      birthDate: birthDate ?? undefined,
      website: website ?? null
    };

    const updatedProfile = await userRepository.updateProfile(userId, updateData);
    //You can set the user as active here but also need to update the user tokens
    //This handled in auth service  when verify email is called 
    //await userRepository.activateSuspendedAccount(userId);
    if (!updatedProfile) {
      throw new Error('Failed to complete user profile');
    }

    return { message: 'User profile completed successfully' };
  }

  /**
   * Get users with pagination and filters
   */
  async getUsers(filters: UserFilters): Promise<UsersResponse> {
    const { page = 1, limit = 20 } = filters;

    const users = await userRepository.getUsers(filters);
    const total = await userRepository.getUsersCount(filters);

    return {
      users,
      pagination: {
        page: parseInt(String(page), 10),
        limit: parseInt(String(limit), 10),
        total,
        pages: Math.ceil(total / parseInt(String(limit), 10))
      }
    };
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string, requesterId: string | null = null): Promise<any> {
    const cacheKey = `user:profile:${userId}`;

    // 1. Try cache
    let user: any;
    try {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        sInfo(`[Redis] Cache HIT: ${cacheKey}`);
        user = JSON.parse(cachedData);
      } else {
        sInfo(`[Redis] Cache MISS: ${cacheKey}`);
      }
    } catch (err) {
      sInfo('Redis error in getUserById:', err);
    }

    if (!user) {
      // 2. Fetch from DB
      user = await userRepository.getUserById(userId, null); // Get base profile without requester context for caching

      if (!user) {
        throw new Error('User not found');
      }

      // 3. Cache base profile
      try {
        await redisClient.setEx(cacheKey, PROFILE_TTL, JSON.stringify(user));
      } catch (err) {
        sInfo('Redis setEx error in getUserById:', err);
      }
    }

    // 4. Inject requester-specific fields if needed
    if (requesterId && requesterId !== userId) {
      const { isFollowing, isFollower } = await userRepository.getFollowStatus(requesterId, userId);
      // Note: Repository getUserById also returns isBlockedByUser, isBlockingUser if requested.
      // For consistency with current UserService.getUserProfile, we'll use getFollowStatus.
      // If we need the full status, we should call repo.getUserById with requesterId, 
      // but that's not easily cacheable per-requester.
      return {
        ...user,
        isFollowing,
        isFollower
      };
    }

    return user;
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string, requesterId: string | null = null): Promise<any> {
    // 1. Try cache for username -> userId mapping
    let userId = await redisClient.get(`username:${username}`);

    if (!userId) {
      // Resolve username to ID via DB
      const user = await userRepository.getUserByUsername(username, null);
      if (!user) {
        throw new Error('User not found');
      }
      userId = user.userId;
      // Cache username -> id mapping for longer (e.g. 24h) since usernames change rarely
      await redisClient.set(`username:${username}`, userId, { EX: 86400 });

      // Can we trust the user object returned? 
      // Yes, but let's reuse getUserProfile logic to ensure consistent shape/caching
    }

    // Delegate to getUserProfile
    return this.getUserProfile(userId! as string, requesterId);
  }

  /**
   * Get current user profile
   */
  async getMe(userId: string): Promise<any> {
    sInfo('User ID:', userId);

    // Check cache
    const cachedUser = await redisClient.get(`user:profile:${userId}`);
    if (cachedUser) {
      sInfo(`[Redis] Cache HIT: user:profile:${userId}`);
      return JSON.parse(cachedUser);
    }
    sInfo(`[Redis] Cache MISS: user:profile:${userId}`);

    const user = await userRepository.getMe(userId);

    if (!user) {
      throw new Error('User not found');
    }

    // Cache for 1 hour
    await redisClient.setEx(`user:profile:${userId}`, PROFILE_TTL, JSON.stringify(user));

    return user;
  }
  async getCurrentUser(userId: string): Promise<any> {
    // Check cache
    const cachedUser = await redisClient.get(`user:profile:${userId}`);
    if (cachedUser) {
      sInfo(`[Redis] Cache HIT: user:profile:${userId}`);
      return JSON.parse(cachedUser);
    }
    sInfo(`[Redis] Cache MISS: user:profile:${userId}`);
    const user = await userRepository.getCurrentUser(userId);

    if (!user) {
      throw new Error('User not found');
    }

    // Cache for 1 hour
    await redisClient.setEx(`user:profile:${userId}`, PROFILE_TTL, JSON.stringify(user));

    return user;
  }

  /**
   * Delete/Deactivate user
   */
  async deleteUser(userId: string, requesterId: string, requesterRole: string): Promise<MessageResponse> {
    // Verify authorization
    if (userId !== requesterId && requesterRole !== 'admin') {
      throw new Error('Unauthorized to delete this user');
    }

    const deactivatedUser = await userRepository.deactivateUser(userId);

    if (!deactivatedUser) {
      throw new Error('User not found');
    }

    return { message: 'User deactivated successfully' };
  }

  /**
   * Follow a user
   */
  async followUser(followerId: string, followingId: string): Promise<FollowResponse> {
    if (followerId === followingId) {
      throw new Error('Cannot follow yourself');
    }

    let client: PoolClient | undefined;
    try {
      client = await userRepository.beginTransaction();

      // Check if target user exists and get privacy status
      // isUserPrivate typically reads, we can use client or not, but better to use client if we want consistency (though reading from snapshot is default in repeatable read/serializable if configured, default is read committed)
      // Since it's just a check, and doesn't accept client in my previous change (I didn't update isUserPrivate), I'll leave it or update strictly what I changed.
      // I only updated createFollow, deleteFollow, getFollowersCount, getFollowingCount, updateFollowersCount, updateFollowingCount.
      const isPrivate = await userRepository.isUserPrivate(followingId);

      if (isPrivate === undefined) {
        throw new Error('User not found');
      }

      const status: 'pending' | 'accepted' = isPrivate ? 'pending' : 'accepted';

      // Create or update follow
      await userRepository.createFollow(followerId, followingId, status, client);

      // Only update counts if status is 'accepted' (not pending)
      if (status === 'accepted') {
        // Get actual counts from follows table
        const followingCount = await userRepository.getFollowingCount(followerId, client);
        const followersCount = await userRepository.getFollowersCount(followingId, client);

        // Update user_profiles with actual counts
        await userRepository.updateFollowingCount(followerId, followingCount, client);
        await userRepository.updateFollowersCount(followingId, followersCount, client);
      }

      await userRepository.commitTransaction(client);

      // Trigger feed invalidation for the follower
      import('./FeedPrecomputeService.js').then(m => m.default.invalidateUserFeed(followerId));

      // Invalidate profiles 
      await redisClient.del(`user:profile:${followerId}`);
      await redisClient.del(`user:profile:${followingId}`);

      return {
        message: status === 'pending' ? 'Follow request sent' : 'Following user',
        status
      };
    } catch (error) {
      if (client) {
        await userRepository.rollbackTransaction(client);
      }
      throw error;
    }
  }

  /**
   * Unfollow a user
   */
  async unfollowUser(followerId: string, followingId: string): Promise<MessageResponse> {
    let client: PoolClient | undefined;
    try {
      client = await userRepository.beginTransaction();

      await userRepository.deleteFollow(followerId, followingId, client);

      // Get actual counts from follows table after deletion
      const followingCount = await userRepository.getFollowingCount(followerId, client);
      const followersCount = await userRepository.getFollowersCount(followingId, client);

      // Update userProfiles with actual counts
      await userRepository.updateFollowingCount(followerId, followingCount, client);
      await userRepository.updateFollowersCount(followingId, followersCount, client);

      await userRepository.commitTransaction(client);

      // Trigger feed invalidation for the unfollower
      import('./FeedPrecomputeService.js').then(m => m.default.invalidateUserFeed(followerId));

      // Invalidate profiles
      await redisClient.del(`user:profile:${followerId}`);
      await redisClient.del(`user:profile:${followingId}`);

      return { message: 'Unfollowed user successfully' };
    } catch (error) {
      if (client) {
        await userRepository.rollbackTransaction(client);
      }
      throw error;
    }
  }

  /**
   * Get user profile with follow status
   */
  async getUserProfile(userId: string, requesterId: string | null = null): Promise<any> {
    let profile: any;

    // 1. Try to get base profile from cache
    const cachedProfile = await redisClient.get(`user:profile:${userId}`);

    if (cachedProfile) {
      sInfo(`[Redis] Cache HIT: user:profile:${userId}`);
      profile = JSON.parse(cachedProfile);
    } else {
      sInfo(`[Redis] Cache MISS: user:profile:${userId}`);
      // 2. If not in cache, fetch from DB (without relationship status first to keep it generic)
      profile = await userRepository.getUserProfile(userId, null);
      if (!profile) {
        throw new Error('User not found');
      }
      // Cache base profile
      await redisClient.setEx(`user:profile:${userId}`, PROFILE_TTL, JSON.stringify(profile));
    }

    // 3. If we have a requester, we need to inject the dynamic relationship status
    if (requesterId && requesterId !== userId) {
      const { isFollowing, isFollower } = await userRepository.getFollowStatus(requesterId, userId);
      return {
        ...profile,
        isFollowing,
        isFollower
      };
    }

    // 4. If no requester or self-request
    return {
      ...profile,
      // Default values if not requester
      isFollowing: false,
      isFollower: false
    };
  }

  /**
   * Get followers for a user
   */
  async getFollowers(userId: string, page: number, limit: number): Promise<any[]> {
    const followers = await userRepository.getFollowers(userId, page, limit);
    return followers;
  }

  /**
   * Get following for a user
   */
  async getFollowing(userId: string, page: number, limit: number): Promise<any[]> {
    const following = await userRepository.getFollowing(userId, page, limit);
    return following;
  }

  /**
   * Get user activity log
   */
  async getActivityLog(userId: string, page: number, limit: number, type?: string): Promise<any[]> {
    return await userRepository.getActivityLog(userId, page, limit, type);
  }
}

export default new UserService();