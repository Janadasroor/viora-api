import { pool } from '../config/pg.config.js';
import type { QueryResult } from 'pg';
import type { VariantInput, MediaInput, MediaFilters } from '@types';
import { sDebug, sError, sInfo } from 'sk-logger';
import { GET_POST_MEDIA_QUERY, GET_REEL_MEDIA_QUERY, GET_STORY_MEDIA_QUERY, GET_USER_MEDIA_QUERY } from '@/queries/media.queries.js';
import { toSnake } from '@/utils/toSnake.js';
import { toCamel } from '@/utils/toCamel.js';

class MediaRepository {
  constructor() {

  }

  // Create new media
  async create(inputs: MediaInput[], user_id: string): Promise<any[]> {
    if (!inputs || inputs.length === 0) {
      return [];
    }

    // Define DB column order once.
    inputs = toSnake(inputs);
    const columns = [
      "user_id",
      "type",
      "original_filename",
      "original_size",
      "width",
      "height",
      "original_path",
      "thumbnail_path",
      "thumbnail_width",
      "thumbnail_height",
      "mime_type",
      "hls_path",
      "metadata",
      "title",
      "description",
      "tags",
      "visibility",
      "location_lat",
      "location_lng",
      "location_name",
      "status"
    ];

    const placeholders = inputs.map((_, rowIndex) => {
      const base = rowIndex * columns.length;
      const rowPlaceholders = columns
        .map((__, colIndex) => `$${base + colIndex + 1}`)
        .join(", ");
      return `(${rowPlaceholders})`;
    }).join(", ");

    const query = `
    INSERT INTO media (${columns.join(", ")})
    VALUES ${placeholders}
    RETURNING *;
  `;

    const values = inputs.flatMap(input =>
      columns.map(col => {
        if (col === "user_id") return user_id;
        if (col === "status") return (input as any)[col] ?? 'processing';
        return (input as any)[col] ?? null;
      })
    );

    const result = await pool.query(query, values);
    return toCamel(result.rows);
  }

  // Get media by ID
  async findById(id: string): Promise<any | null> {
    const query = 'SELECT * FROM media WHERE id = $1 AND deleted_at IS NULL';
    const result: QueryResult = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  // Get media by user ID
  async findByUserId(userId: string, limit: number = 20, offset: number = 0): Promise<any[]> {
    const query = `
      SELECT * FROM media 
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const result: QueryResult = await pool.query(query, [userId, limit, offset]);
    return result.rows;
  }
  // Get media by target ID Reel,Post,Story
  async getMediaPaths(targetId: string, target_type: string): Promise<any[]> {
    try {
      const tableName = target_type == 'REEL' ? 'reel_media' : target_type == 'POST' ? 'post_media' : 'story_media';
      const targetIdColumn = target_type == 'REEL' ? 'reel_id' : target_type == 'POST' ? 'post_id' : 'story_id';
      sDebug(`Table Name: ${tableName}, Target ID Column: ${targetIdColumn}, Target ID: ${targetId}, Target Type: ${target_type}`);
      const query = `
      SELECT m.id,m.original_path,m.thumbnail_path, m.metadata,
      json_agg(vv.file_path ORDER BY vv.quality_label) as variant_paths  FROM ${tableName} 
      JOIN media m ON m.id = ${tableName}.media_id
      LEFT JOIN video_variants vv ON m.id = vv.media_id
      WHERE ${targetIdColumn} = $1 
      GROUP BY m.id, m.original_path, m.thumbnail_path, m.metadata;

    `;

      const result = await pool.query(query, [targetId]);
      return toCamel(result.rows);
    }
    catch (err) {
      sError(err)
      return []
    }
  }
  // Search media with filters
  async search(filters: MediaFilters, limit: number = 20, offset: number = 0): Promise<any[]> {
    const conditions: string[] = ['deleted_at IS NULL'];
    const values: any[] = [];
    let paramCount = 1;

    if (filters.userId) {
      conditions.push(`user_id = $${paramCount}`);
      values.push(filters.userId);
      paramCount++;
    }

    if (filters.type) {
      conditions.push(`type = $${paramCount}`);
      values.push(filters.type);
      paramCount++;
    }

    if (filters.status) {
      conditions.push(`status = $${paramCount}`);
      values.push(filters.status);
      paramCount++;
    }

    if (filters.visibility) {
      conditions.push(`visibility = $${paramCount}`);
      values.push(filters.visibility);
      paramCount++;
    }

    if (filters.category) {
      conditions.push(`category = $${paramCount}`);
      values.push(filters.category);
      paramCount++;
    }

    if (filters.tags && filters.tags.length > 0) {
      conditions.push(`tags && $${paramCount}`);
      values.push(filters.tags);
      paramCount++;
    }

    if (filters.isFlagged !== undefined) {
      conditions.push(`is_flagged = $${paramCount}`);
      values.push(filters.isFlagged);
      paramCount++;
    }

    if (filters.moderationStatus) {
      conditions.push(`moderation_status = $${paramCount}`);
      values.push(filters.moderationStatus);
      paramCount++;
    }

    if (filters.startDate) {
      conditions.push(`created_at >= $${paramCount}`);
      values.push(filters.startDate);
      paramCount++;
    }

    if (filters.endDate) {
      conditions.push(`created_at <= $${paramCount}`);
      values.push(filters.endDate);
      paramCount++;
    }

    values.push(limit, offset);

    const query = `
      SELECT * FROM media 
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}
    `;

    const result: QueryResult = await pool.query(query, values);
    return result.rows;
  }

  // Update media
  async update(id: string, input: Partial<MediaInput>): Promise<any | null> {
    input = toSnake(input);
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    Object.entries(input).forEach(([key, value]) => {
      if (value !== undefined) {
        fields.push(`${key} = $${paramCount}`);
        values.push(value);
        paramCount++;
      }
    });

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE media 
      SET ${fields.join(', ')}
      WHERE id = $${paramCount} AND deleted_at IS NULL
      RETURNING *
    `;

    const result: QueryResult = await pool.query(query, values);
    return result.rows[0] || null;
  }

  // Update processing status
  async updateProcessingStatus(id: string, status: string): Promise<any | null> {
    const query = `
      UPDATE media 
      SET status = $1::text,
          updated_at = NOW()
      WHERE id = $2::uuid AND deleted_at IS NULL
      RETURNING *
    `;

    const result: QueryResult = await pool.query(query, [status, id]);
    return result.rows[0] || null;
  }

  // Update NSFW label
  async updateNSFWLabel(id: string, label: string): Promise<void> {
    const query = 'UPDATE media SET nsfw_label = $1, updated_at = NOW() WHERE id = $2';
    await pool.query(query, [label, id]);
  }

  // Publish media
  async publish(id: string): Promise<any | null> {
    const query = `
      UPDATE media 
      SET published_at = NOW(),
          visibility = 'public',
          updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING *
    `;

    const result: QueryResult = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  // Flag media
  async flag(id: string, reason: string): Promise<any | null> {
    const query = `
      UPDATE media 
      SET is_flagged = true,
          flag_reason = $1,
          updated_at = NOW()
      WHERE id = $2 AND deleted_at IS NULL
      RETURNING *
    `;

    const result: QueryResult = await pool.query(query, [reason, id]);
    return result.rows[0] || null;
  }

  // Moderate media
  async moderate(id: string, status: string, moderatorId: string): Promise<any | null> {
    const query = `
      UPDATE media 
      SET moderation_status = $1,
          moderated_by = $2,
          moderated_at = NOW(),
          updated_at = NOW()
      WHERE id = $3 AND deleted_at IS NULL
      RETURNING *
    `;

    const result: QueryResult = await pool.query(query, [status, moderatorId, id]);
    return result.rows[0] || null;
  }

  // Soft delete media
  async softDelete(id: string): Promise<boolean> {
    const query = `
      UPDATE media 
      SET deleted_at = NOW(),
          updated_at = NOW()
      WHERE id = $1 AND deleted_at IS NULL
    `;

    const result: QueryResult = await pool.query(query, [id]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async hardDelete(ids: string[]): Promise<boolean> {
    sDebug(ids);
    const query = 'DELETE FROM media WHERE id = ANY($1)';
    const result: QueryResult = await pool.query(query, [ids]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  // Video Variants Methods
  // Updated repository method for bulk insert
  async createVariant(variants: VariantInput[]): Promise<any[]> {
    // Convert camelCase → snake_case
    variants = toSnake(variants);

    if (variants.length === 0) {
      return [];
    }

    const columns = [
      "media_id",
      "resolution",
      "width",
      "height",
      "quality_label",
      "file_path",
      "file_size",
      "file_format",
      "codec",
      "bitrate",
      "container",
      "status"
    ];

    const valuesClause = variants
      .map((_, rowIndex) => {
        const base = rowIndex * columns.length;
        const rowPlaceholders = columns
          .map((__, colIndex) => `$${base + colIndex + 1}`)
          .join(", ");
        return `(${rowPlaceholders})`;
      })
      .join(", ");

    const query = `
    INSERT INTO video_variants (${columns.join(", ")})
    VALUES ${valuesClause}
    RETURNING *;
  `;

    const values = variants.flatMap(v =>
      columns.map(col => (v as any)[col] ?? null)
    );

    const result: QueryResult = await pool.query(query, values);
    return result.rows;
  }

  // Updated processing code with better error handling


  // Alternative: Using PostgreSQL unnest() for even better performance with large datasets
  async createVariantWithUnnest(variants: VariantInput[]): Promise<any[]> {
    variants = toSnake(variants);
    if (variants.length === 0) {
      return [];
    }

    const query = `
    INSERT INTO video_variants (
      media_id, resolution, width, height, quality_label, file_path,
      file_size, file_format, codec, bitrate, container
    )
    SELECT * FROM unnest(
      $1::uuid[],
      $2::text[],
      $3::integer[],
      $4::integer[],
      $5::text[],
      $6::text[],
      $7::bigint[],
      $8::text[],
      $9::text[],
      $10::integer[],
      $11::text[]
    )
    RETURNING *
  `;
    const columns = [
      "media_id",
      "resolution",
      "width",
      "height",
      "quality_label",
      "file_path",
      "file_size",
      "file_format",
      "codec",
      "bitrate",
      "container"
    ];

    const values = variants.flatMap(v =>
      columns.map(col => (v as any)[col] ?? null)
    );

    const result: QueryResult = await pool.query(query, values);
    return result.rows;
  }
  async getVariantsByMediaId(mediaId: string): Promise<any[]> {
    const query = `
      SELECT * FROM video_variants 
      WHERE media_id = $1
      ORDER BY height DESC
    `;

    const result: QueryResult = await pool.query(query, [mediaId]);
    return result.rows;
  }

  async getDefaultVariant(mediaId: string): Promise<any | null> {
    const query = `
      SELECT * FROM video_variants 
      WHERE media_id = $1 AND is_default = true
      LIMIT 1
    `;

    const result: QueryResult = await pool.query(query, [mediaId]);
    return result.rows[0] || null;
  }

  async updateVariantPlayCount(variantId: string): Promise<void> {
    const query = `
      UPDATE video_variants 
      SET play_count = play_count + 1,
          last_accessed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `;

    await pool.query(query, [variantId]);
  }
  async getPostsMedia(postIds: string[]): Promise<Record<string, any[]>> {
    if (!postIds || postIds.length === 0) return {};

    const mediaResult = await pool.query(GET_POST_MEDIA_QUERY, [postIds]);
    const mediaResults = mediaResult.rows.map(m => this.mapMediaSafety(m));

    const mediaByPost = mediaResults.reduce((acc: any, media: any) => {
      if (!acc[media.post_id]) acc[media.post_id] = [];
      acc[media.post_id].push(media);
      return acc;
    }, {});

    return mediaByPost;
  }
  async getUsersMedia(userIds: string[]): Promise<Record<string, any[]>> {
    if (!userIds || userIds.length === 0) {
      return {};
    }
    try {
      const result = await pool.query(GET_USER_MEDIA_QUERY, [userIds]);
      const mediaByUser: Record<string, any[]> = {};

      for (const row of result.rows) {
        const mappedRow = this.mapMediaSafety(row);
        if (!mediaByUser[mappedRow.user_id]) mediaByUser[mappedRow.user_id] = [];
        mediaByUser[mappedRow.user_id]!.push(mappedRow);
      }

      return mediaByUser;
    } catch (err) {
      sError('Error fetching user media:', err);
      return {};
    }
  }
  async getReelsMedia(reelIds: string[]): Promise<Record<string, any[]>> {
    if (!reelIds || reelIds.length === 0) {
      return {};
    }
    try {
      const result = await pool.query(GET_REEL_MEDIA_QUERY, [reelIds]);
      const mediaByReel: Record<string, any[]> = {};

      for (const row of result.rows) {
        const mappedRow = this.mapMediaSafety(row);
        if (!mediaByReel[mappedRow.reel_id]) mediaByReel[mappedRow.reel_id] = [];
        mediaByReel[mappedRow.reel_id]!.push(mappedRow);
      }

      return mediaByReel;
    } catch (err) {
      sError('Error fetching reel media:', err);
      return {};
    }
  }
  async getStoriesMedia(storyIds: string[]): Promise<Record<string, any[]>> {
    if (!storyIds || storyIds.length === 0) {
      return {};
    }
    try {
      const result = await pool.query(GET_STORY_MEDIA_QUERY, [storyIds]);
      const mediaByStory: Record<string, any[]> = {};

      for (const row of result.rows) {
        const mappedRow = this.mapMediaSafety(row);
        if (!mediaByStory[mappedRow.story_id]) mediaByStory[mappedRow.story_id] = [];
        mediaByStory[mappedRow.story_id]!.push(mappedRow);
      }

      return mediaByStory;
    } catch (err) {
      sError('Error fetching story media:', err);
      return {};
    }
  }

  private mapMediaSafety(media: any) {
    let safeLevel = 0;
    if (media.nsfw_label === 'sexual') safeLevel = 2;
    else if (media.nsfw_label === 'suggestive') safeLevel = 1;

    return {
      ...media,
      safeMode: safeLevel
    };
  }
}

export default new MediaRepository;