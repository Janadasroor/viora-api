export interface PostSearchResult {
  postId: string;
  userId: string;
  caption: string;
  postType: string;
  visibility: string;
  location: string | null;
  likesCount: string;
  commentsCount: string;
  sharesCount: string;
  viewsCount: string;
  createdAt: Date;
  username: string;
  displayName: string;
  userMedia?: MediaResult[];
  isVerified: boolean;
  userLiked: boolean;
  userSaved: boolean;
  isFollowing: boolean;
  hashtags: string | null;
  relevanceScore: number;
  media?: MediaResult[];
}

export interface MediaResult {
  postId: string;
  mediaId: string;
  filePath: string;
  mimeType: string;
  mediaType: string;
  width: number;
  height: number;
  thumbnailPath: string | null;
  fileName: string;
  altText: string | null;
  mediaOrder: number;
}

export interface UserSearchResult {
  userId: string;
  username: string;
  accountStatus: string;
  displayName: string;
  media?: MediaResult[];
  bio: string | null;
  isVerified: boolean;
  followersCount: string;
  followingCount: string;
  postsCount: string;
  isFollowing: boolean;
  followsYou: boolean;
  relevanceScore: number;
}

export interface HashtagSearchResult {
  hashtagId: string;
  tagName: string;
  postsCount: string;
  trendingScore: string;
  isTrending: boolean;
  createdAt: Date;
  relevanceScore: number;
}

export interface LocationSearchResult {
  location: string;
  postsCount: string;
  lastPostAt: Date;
}

export interface UnifiedSearchResult {
  posts: PostSearchResult[];
  users: UserSearchResult[];
  hashtags: Omit<HashtagSearchResult, 'relevanceScore'>[];
  locations: LocationSearchResult[];
}

export interface SearchSuggestion {
  type: 'user' | 'hashtag' | 'location';
  value: string;
  image: string | null;
}

export type SortBy = 'relevance' | 'recent' | 'popular';
export type SuggestionType = 'all' | 'users' | 'hashtags' | 'locations';
