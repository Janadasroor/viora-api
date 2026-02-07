export function toCamel(input: any): any {
  if (Array.isArray(input)) {
    return input.map(item => toCamel(item));
  }

  if (input !== null && typeof input === "object") {
    // If it's a Date → return as-is
    if (input instanceof Date) return input;

    // If it's something else non-plain (Buffer, BigInt, etc.) → return as-is
    if (Object.prototype.toString.call(input) !== "[object Object]") {
      return input;
    }

    const result: any = {};
    for (const key in input) {
      if (Object.prototype.hasOwnProperty.call(input, key)) {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        result[camelKey] = toCamel(input[key]);
      }
    }
    return result;
  }

  // Primitive values → return as-is
  return input;
}

export const COMPLEX_SNAKE_INPUT = {
  user_id: 42,
  full_name: "John_Doe_Example",        // value must stay unchanged
  account_created_at: "2025-12-09T15:19:36.000Z",
  is_account_active: true,

  user_profiles: [
    {
      profile_id: 11,
      profile_type: "creator_user",
      avatar_url: "https://example.com/avatar_2.png",
      profile_created_at: "2025-06-10T00:00:00.000Z",
      extra_data: {
        meta_score: 77,
        badge_info: {
          badge_type: "silver_member",
          awarded_at: "2025-07-07T00:00:00.000Z"
        }
      }
    }
  ],

  media_items: [
    {
      media_id: 101,
      media_type: "video",
      media_url: "https://cdn.example.com/user_42/video_file_1.mp4",
      media_path: "/local/user_42/video_file_1.mp4",
      media_metadata: {
        media_width: 1920,
        media_height: 1080,
        media_duration_seconds: 36,
        media_bitrate: 5400,
        frame_data: [
          {
            frame_index: 0,
            detected_labels: ["person", "building", "car_sedan"] // value stays unchanged
          },
          {
            frame_index: 1,
            detected_labels: ["dog", "tree", "road_lane"] // unchanged
          }
        ]
      }
    }
  ],

  security_logs: [
    {
      log_id: 9002,
      ip_address: "192.168.1.56",
      log_type: "password_change",
      log_status: "failed",
      log_time: "2025-12-09T15:25:00.000Z"
    }
  ]
};

