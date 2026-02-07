
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { sError, sDebug } from 'sk-logger';
import path from 'path';

export interface EmbeddingResult {
    embedding: number[];
    predictions: Record<string, number>;
    top_label: string;
    probability: number;
}

export interface MultiModalEmbeddingResult {
    visual_embedding: number[];  // CLIP embedding (512-dim)
    vision_embedding: number[];  // ViT embedding (768-dim) - Added for pure visual ranking
    text_embedding: number[] | null;  // Text embedding (768-dim)
    ocr_text: string;
    ocr_details: {
        text: string;
        word_count: number;
        detections: Array<{
            text: string;
            confidence: number;
            bbox: any;
        }>;
        detection_count: number;
    };
    caption: string;
    combined_text: string;
    alignment_score: number;
    content_type: 'meme' | 'aesthetic' | 'mixed' | 'text_only';
    predictions: Record<string, number>;
    top_label: string;
    probability: number;
}

class VectorEmbeddingService {
    private embeddingServerUrl: string;
    private useMultimodal: boolean;

    constructor() {
        // Default to localhost:8000 if not set
        this.embeddingServerUrl = process.env.EMBEDDING_SERVER_URL || 'http://localhost:8000';
        // Feature flag: use new multi-modal endpoint if available
        this.useMultimodal = process.env.USE_MULTIMODAL_EMBEDDINGS === 'true' || false;
    }

    /**
     * Generate embedding and NSFW classification for an image file
     * Uses legacy endpoint for backward compatibility
     */
    async generateImageEmbedding(filePath: string): Promise<EmbeddingResult | null> {
        try {
            if (!fs.existsSync(filePath)) {
                const errorMsg = `File not found: ${filePath}`;
                sError(errorMsg);
                return null;
            }

            // Check file size to avoid sending too large files
            const stats = fs.statSync(filePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            if (fileSizeMB > 50) {
                sError(`File too large (${fileSizeMB.toFixed(2)}MB): ${filePath}. Max size: 50MB`);
                return null;
            }

            const formData = new FormData();
            formData.append('files', fs.createReadStream(filePath));

            const response = await axios.post(`${this.embeddingServerUrl}/extract-features`, formData, {
                headers: {
                    ...formData.getHeaders(),
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 120000 // 2 minute timeout
            });

            if (response.data && response.data.results && response.data.results.length > 0) {
                const result = response.data.results[0];
                return {
                    embedding: result.embedding,
                    predictions: result.predictions,
                    top_label: result.top_label,
                    probability: result.probability
                };
            }

            sError(`No embedding returned from service for ${filePath}`);
            return null;

        } catch (error: any) {
            // Extract more detailed error information
            let errorMessage = 'Unknown error';
            let errorDetails = '';

            if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') {
                errorMessage = `Connection error (${error.code}): Embedding service may be down or unreachable`;
                errorDetails = `Service URL: ${this.embeddingServerUrl}. The service may have crashed or is not running.`;
            } else if (error.response) {
                // Server responded with error status
                errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
                const responseData = error.response.data;
                if (typeof responseData === 'string') {
                    errorDetails = responseData;
                } else if (responseData?.detail) {
                    errorDetails = responseData.detail;
                } else if (responseData?.error) {
                    errorDetails = responseData.error;
                } else if (responseData?.message) {
                    errorDetails = responseData.message;
                }
            } else if (error.request) {
                // Request was made but no response received
                errorMessage = 'No response from embedding service';
                errorDetails = `Service may be down or unreachable at ${this.embeddingServerUrl}`;
            } else {
                // Error in setting up the request
                errorMessage = error.message || 'Request setup error';
            }

            sError(`Error generating image embedding for ${filePath}:`, {
                message: errorMessage,
                details: errorDetails,
                code: error.code
            });

            return null;
        }
    }

    /**
     * Generate multi-modal embeddings for an image file
     * Returns CLIP visual embedding, text embedding, OCR, and metadata
     */
    async generateMultiModalEmbedding(
        filePath: string,
        caption?: string
    ): Promise<MultiModalEmbeddingResult | null> {
        const item: { filePath: string; caption?: string } = { filePath };
        if (caption) item.caption = caption;
        const results = await this.generateMultiModalEmbeddings([item]);
        return results.length > 0 ? (results[0] as MultiModalEmbeddingResult) : null;
    }

    /**
     * Generate multi-modal embeddings for multiple image files in one request
     */
    async generateMultiModalEmbeddings(
        items: Array<{ filePath: string; caption?: string }>
    ): Promise<MultiModalEmbeddingResult[]> {
        try {
            const formData = new FormData();
            let validFilesCount = 0;

            for (const item of items) {
                if (!fs.existsSync(item.filePath)) {
                    sDebug(`File not found, skipping: ${item.filePath}`);
                    continue;
                }

                // Check file size (max 50MB)
                const stats = fs.statSync(item.filePath);
                if (stats.size / (1024 * 1024) > 50) {
                    sDebug(`File too large, skipping: ${item.filePath}`);
                    continue;
                }

                formData.append('files', fs.createReadStream(item.filePath));
                if (item.caption) {
                    // Note: The python server currently takes a single caption across all files
                    // if passed this way. We might need to adjust if each needs a unique caption.
                    // For now, we'll append the first one found or handle it as the server expects.
                    formData.append('caption', item.caption);
                }
                validFilesCount++;
            }

            if (validFilesCount === 0) return [];

            const response = await axios.post(
                `${this.embeddingServerUrl}/extract-multimodal`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: 900000 // 15 minute timeout for batches
                }
            );

            if (response.data && response.data.results) {
                return response.data.results.map((result: any, index: number) => {
                    if (result.error) {
                        sError(`Embedding service error for file index ${index}:`, result.error);
                        return null;
                    }

                    return {
                        visual_embedding: result.visual_embedding,
                        vision_embedding: result.vision_embedding || [],
                        text_embedding: result.text_embedding || null,
                        ocr_text: result.ocr_text || '',
                        ocr_details: result.ocr_details || {
                            text: '',
                            word_count: 0,
                            detections: [],
                            detection_count: 0
                        },
                        caption: result.caption || '',
                        combined_text: result.combined_text || '',
                        alignment_score: result.alignment_score || 0,
                        content_type: result.content_type || 'aesthetic',
                        predictions: result.predictions,
                        top_label: result.top_label,
                    };
                });
            }

            return [];

        } catch (error: any) {
            sError(`Error generating multi-modal embeddings batch:`, error.message);
            return [];
        }
    }

    /**
     * Generate embedding and NSFW classification for a video file
     */
    async generateVideoEmbedding(filePath: string, caption?: string): Promise<EmbeddingResult | null> {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const formData = new FormData();
            formData.append('files', fs.createReadStream(filePath));
            if (caption) {
                formData.append('caption', caption);
            }

            const response = await axios.post(
                `${this.embeddingServerUrl}/extract-features-video`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                }
            );

            if (response.data && response.data.results && response.data.results.length > 0) {
                const result = response.data.results[0];

                if (result.error) {
                    throw new Error(result.error);
                }

                // For backward compatibility, return visual embedding as main embedding
                return {
                    embedding: result.visual_embedding || [],
                    predictions: result.predictions,
                    top_label: result.top_label,
                    probability: result.probability
                };
            }

            return null;

        } catch (error) {
            sError('Error generating video embedding:', error);
            return null;
        }
    }

    /**
     * Generate multi-modal embeddings for a video file
     */
    async generateMultiModalVideoEmbedding(
        filePath: string,
        caption?: string
    ): Promise<MultiModalEmbeddingResult | null> {
        try {
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const formData = new FormData();
            formData.append('files', fs.createReadStream(filePath));
            if (caption) {
                formData.append('caption', caption);
            }

            const response = await axios.post(
                `${this.embeddingServerUrl}/extract-features-video`,
                formData,
                {
                    headers: {
                        ...formData.getHeaders(),
                    },
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity
                }
            );

            if (response.data && response.data.results && response.data.results.length > 0) {
                const result = response.data.results[0];

                if (result.error) {
                    throw new Error(result.error);
                }

                return {
                    visual_embedding: result.visual_embedding,
                    vision_embedding: result.vision_embedding || [],
                    text_embedding: result.text_embedding || null,
                    ocr_text: result.ocr_text || '',
                    ocr_details: {
                        text: result.ocr_text || '',
                        word_count: (result.ocr_text || '').split(/\s+/).length,
                        detections: [],
                        detection_count: 0
                    },
                    caption: result.caption || '',
                    combined_text: result.ocr_text || result.caption || '',
                    alignment_score: 0, // Videos don't have alignment score yet
                    content_type: result.content_type || 'aesthetic',
                    predictions: result.predictions,
                    top_label: result.top_label,
                    probability: result.probability
                };
            }

            return null;

        } catch (error) {
            sError('Error generating multi-modal video embedding:', error);
            return null;
        }
    }

    /**
     * Generate embedding for a single text string
     */
    async generateTextEmbedding(text: string): Promise<number[] | null> {
        const results = await this.generateTextEmbeddings([text]);
        return results.length > 0 ? (results[0] || null) : null;
    }

    /**
     * Generate embeddings for multiple text strings in one request
     */
    async generateTextEmbeddings(texts: string[]): Promise<number[][]> {
        try {
            if (!texts || texts.length === 0) return [];

            const response = await axios.post(`${this.embeddingServerUrl}/extract-features-text-batch`, { texts });

            if (response.data && response.data.embeddings) {
                return response.data.embeddings;
            }

            return [];
        } catch (error) {
            sError('Error generating text embeddings batch:', error);
            return [];
        }
    }
}

export default new VectorEmbeddingService();
