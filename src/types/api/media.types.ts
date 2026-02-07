export interface MediaRequest {
  userId: string;
  targetId: string,
  targetType: "POST" | "REEL" | "STORY" | "USER"
  images: string[];
  videos: string[];
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: string;
  locationLat?: number;
  locationLng?: number;
  locationName?: string;
}
export interface MediaDeleteRequest {
  userId: string;
  targetId: string;
  targetType: "POST" | "REEL" | "STORY" | "USER";
}
export interface MediaInput {
  type: string;
  originalFilename: string;
  originalSize: number;
  originalPath: string;
  width: number;
  height: number;
  thumbnailPath: string;
  thumbnailHeight: number;
  thumbnailWidth: number;
  mimeType: string;
  hlsPath?: string;
  metadata?: any;
  title?: string;
  description?: string;
  tags?: string[];
  visibility?: string;
  locationLat?: number;
  locationLng?: number;
  locationName?: string;
}


export interface MediaFilters {
  userId?: string;
  type?: string;
  status?: string;
  visibility?: string;
  category?: string;
  tags?: string[];
  isFlagged?: boolean;
  moderationStatus?: string;
  startDate?: Date;
  endDate?: Date;
}

export interface VariantInput {
  mediaId: string;
  resolution: string;
  width: number;
  height: number;
  qualityLabel: string;
  filePath: string;
  fileSize: number;
  fileFormat: string;
  codec: string;
  bitrate: number;
  container: string;
  status?: string; // Added status field
}

export interface VariantOutput {
  resolution: string;
  width: number;
  height: number;
  qualityLabel: string;
  filePath: string;
  fileSize: number;
  fileFormat: string;
  codec: string;
  bitrate: number;
  container: string;
}
