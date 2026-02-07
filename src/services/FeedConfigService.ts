import feedConfigRepository from '../repositories/FeedConfigRepository.js';
class FeedConfigService {
  async update(key:string, value:string) {
    const result = await feedConfigRepository.update(key, value);
    return result;
  }

  async getAll() {
    const result = await feedConfigRepository.getAll();
    return result;
  }
}

export default new FeedConfigService();