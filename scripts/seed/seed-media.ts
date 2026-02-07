import axios from "axios";
import { baseUrl } from "../utils/get-base-url";

type MediaType = 'image' | 'video' | 'all';
type TargetType = 'POST' | 'REEL' | 'STORY' | 'USER';

interface MediaUploadParams {
    files: File[];
    title?: string;
    description?: string;
    targetId?: string;
    targetType?: TargetType;
    accessToken?: string;
}

function buildEndpoint(path: MediaType, targetId?: string, targetType?: TargetType) {
    const endpoint = `${baseUrl}media/upload/${path}`;
    const params: Record<string, string> = {};
    if (targetId) params.postId = targetId;
    if (targetType) params.targetType = targetType;
    return { endpoint, params };
}

export async function uploadImages(params: MediaUploadParams) {
    try {
        const { files, title, description, targetId, targetType, accessToken } = params;
        const formData = new FormData();

        files.forEach((file) => formData.append("image", file));

        if (title) formData.append("title", title);
        if (description) formData.append("description", description);

        const { endpoint, params: queryParams } = buildEndpoint("image", targetId, targetType);

        const headers: Record<string, string> = {
            "Cache-Control": "no-store",
        };

        if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
        }

        const res = await axios.post(endpoint, formData, {
            withCredentials: true,
            params: queryParams,
            headers,
        });

        const data = res.data;

        if (!data || data.success === false) {
            throw new Error(data?.error || "Failed to upload images");
        }

        return data;
    } catch (err: any) {
        return {
            success: false,
            error: err?.response?.data?.error || err?.message || "Failed to upload images",
        };
    }
}

/**
 * Upload videos using axios (browser)
 */
export async function uploadVideos(params: MediaUploadParams) {
    try {
        const { files, title, description, targetId, targetType, accessToken } = params;
        const formData = new FormData();

        files.forEach((file) => formData.append("video", file));

        if (title) formData.append("title", title);
        if (description) formData.append("description", description);

        const { endpoint, params: queryParams } = buildEndpoint("video", targetId, targetType);

        const headers: Record<string, string> = {
            "Cache-Control": "no-store",
        };

        if (accessToken) {
            headers["Authorization"] = `Bearer ${accessToken}`;
        }

        const res = await axios.post(endpoint, formData, {
            withCredentials: true,
            params: queryParams,
            headers,
        });

        const data = res.data;

        if (!data || data.success === false) {
            throw new Error(data?.error || "Failed to upload videos");
        }

        return data;
    } catch (err: any) {
        return {
            success: false,
            error: err?.response?.data?.error || err?.message || "Failed to upload videos",
        };
    }
}
