
export const GET_MEDIA_QUERY = `
        SELECT 
          sm.story_id, 
          m.id as media_id,
          m.original_path as file_path,
          m.mime_type,
          m.type as media_type,
          m.width,
          m.height,
          m.duration,
          m.aspect_ratio,
          m.has_audio,
          m.title,
          m.description,
          sm.media_order,(
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
							vv.file_size,
							'bitrate',
							vv.bitrate,
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
			)
		as variants

        FROM story_media sm
        JOIN media m ON sm.media_id = m.id
        WHERE sm.story_id = ANY($1)
          AND m.deleted_at IS NULL
        ORDER BY sm.story_id, sm.media_order
      `;