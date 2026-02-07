
export const VIDEO_VARIANTS_SUBQUERY = `
  (
    SELECT
      JSON_AGG (
        JSON_BUILD_OBJECT (
          'variant_id',
          vv.id,
          'quality',
          vv.quality_label,
          'resolution',
          vv.resolution,
          'file_path',
          vv.file_path,
          'file_size',
          vv.file_size::text,
          'bitrate',
          vv.bitrate::text,
          'codec',
          vv.codec,
          'format',
          vv.container,
          'width',
          vv.width,
          'height',
          vv.height,
          'fps',
          vv.fps,
          'status',
          vv.status
        )
        ORDER BY
          vv.bitrate DESC
      )
    FROM
      video_variants vv
    WHERE
      vv.media_id = m.id
  ) as variants
`;

export const GET_POST_MEDIA_QUERY = `
  SELECT 
    pm.post_id, 
    m.id as media_id,
    m.original_path as file_path,
    m.thumbnail_path,
    m.hls_path,
    m.mime_type,
    m.type as media_type,
    m.width,
    m.height,
    m.duration,
    m.aspect_ratio,
    m.has_audio,
    m.title,
    m.description,
    m.nsfw_label,
    pm.media_order,
    ${VIDEO_VARIANTS_SUBQUERY}
  FROM post_media pm
  JOIN media m ON pm.media_id = m.id
  WHERE pm.post_id = ANY($1)
    AND m.status = 'ready'
    AND m.deleted_at IS NULL
  ORDER BY pm.post_id, pm.media_order
`;

export const GET_POST_MEDIA_WITH_STATUS_QUERY = `
  SELECT 
    pm.post_id, 
    m.id as media_id,
    m.original_path as file_path,
    m.thumbnail_path,
    m.hls_path,
    m.mime_type,
    m.type as media_type,
    m.width,
    m.height,
    m.duration,
    m.aspect_ratio,
    m.has_audio,
    m.title,
    m.description,
    m.nsfw_label,
    pm.media_order,
    ${VIDEO_VARIANTS_SUBQUERY}
  FROM post_media pm
  JOIN media m ON pm.media_id = m.id
  WHERE pm.post_id = ANY($1)
    AND m.status = 'ready'
    AND m.deleted_at IS NULL
  ORDER BY pm.post_id, pm.media_order
`;

export const GET_REEL_MEDIA_QUERY = `
  SELECT 
    rm.reel_id, 
    m.id as media_id,
    m.original_path as file_path,
    m.thumbnail_path,
    m.hls_path,
    m.mime_type,
    m.type as media_type,
    m.width,
    m.height,
    m.duration,
    m.aspect_ratio,
    m.has_audio,
    m.title,
    m.description,
    m.nsfw_label,
    rm.media_order,
    ${VIDEO_VARIANTS_SUBQUERY}
  FROM reel_media rm
  JOIN media m ON rm.media_id = m.id
  WHERE rm.reel_id = ANY($1)
    AND m.status = 'ready'
    AND m.deleted_at IS NULL
  ORDER BY rm.reel_id, rm.media_order
`;

export const GET_STORY_MEDIA_QUERY = `
  SELECT 
    sm.story_id, 
    m.id as media_id,
    m.original_path as file_path,
    m.thumbnail_path,
    m.hls_path,
    m.mime_type,
    m.type as media_type,
    m.width,
    m.height,
    m.duration,
    m.aspect_ratio,
    m.has_audio,
    m.title,
    m.description,
    m.nsfw_label,
    sm.media_order,
    ${VIDEO_VARIANTS_SUBQUERY}
  FROM story_media sm
  JOIN media m ON sm.media_id = m.id
  WHERE sm.story_id = ANY($1)
    AND m.status = 'ready'
    AND m.deleted_at IS NULL
  ORDER BY sm.story_id, sm.media_order
`;

export const GET_USER_MEDIA_QUERY = `
  SELECT 
    um.user_id, 
    m.id as media_id,
    m.original_path as file_path,
    m.thumbnail_path,
    m.hls_path,
    m.mime_type,
    m.type as media_type,
    m.width,
    m.height,
    m.duration,
    m.aspect_ratio,
    m.has_audio,
    m.title,
    m.description,
    m.nsfw_label,
    ${VIDEO_VARIANTS_SUBQUERY}
  FROM user_media um
  JOIN media m ON um.media_id = m.id
  WHERE um.user_id = ANY($1)
    AND m.deleted_at IS NULL
  ORDER BY um.user_media_id DESC
`;
