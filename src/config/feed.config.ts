import feedConfigRepository from "../repositories/FeedConfigRepository.js";
let cachedConfig: Record<string, string | number> | null = null;
let lastFetched = 0;

async function getFeedConfigCached() {
  if (!cachedConfig || Date.now() - lastFetched > 5 * 60 * 1000) {
    cachedConfig = await feedConfigRepository.getAll();
    lastFetched = Date.now();
  }

  return cachedConfig;
}
async function setUpFeedConfig(key: string, value: string | number) {
  await feedConfigRepository.update(key, value.toString());
}

export const FEED_CONFIG = {
  SUGGESTION_DAYS: 7,
  MIN_ENGAGEMENT: 5,
  DEFAULT_PAGE_SIZE: 10,
  SIMILARITY_WEIGHT: 2.0,
  ENGAGEMENT_WEIGHT: 0.5,
  POPULARITY_WEIGHT: 0.3,
  RECENCY_DECAY: 0.8,
}

export default getFeedConfigCached;
