# Multi-Modal Feed Ranking Migration Guide

## Overview

This document describes the migration from ViT-only visual similarity to a multi-modal semantic ranking system using CLIP, OCR, and text embeddings.

## Architecture Changes

### Before (ViT-Only)

```
Image Upload
    ↓
ViT Embedding (768-dim)
    ↓
Qdrant (single vector)
    ↓
Visual Similarity Ranking
```

### After (Multi-Modal)

```
Image Upload
    ↓
├─→ CLIP Visual Embedding (512-dim)
├─→ OCR Text Extraction
├─→ Text Embedding (768-dim, caption + OCR)
├─→ Image-Text Alignment Score
└─→ Content Type Classification
    ↓
Qdrant (named vectors: visual + text)
    ↓
Multi-Signal Ranking:
  - Visual Similarity (30%)
  - Text Similarity (25%)
  - Engagement (20%)
  - Recency (15%)
  - Diversity (10%)
```

## Implementation Details

### 1. Python ML Service Updates

**New Models:**
- CLIP (`openai/clip-vit-base-patch32`) for visual embeddings
- Sentence Transformers (`all-mpnet-base-v2`) for text embeddings
- EasyOCR for text extraction

**New Endpoints:**
- `POST /extract-multimodal` - Full multi-modal extraction
- `POST /extract-ocr` - OCR-only extraction

**Backward Compatibility:**
- Legacy endpoints still work
- Old ViT embeddings remain accessible

### 2. Qdrant Schema Updates

**New Collection:** `media_embeddings_v2`
- Named vectors:
  - `visual`: 512-dim (CLIP)
  - `text`: 768-dim (sentence-transformers)
- Metadata:
  - `content_type`: meme | aesthetic | mixed | text_only
  - `alignment_score`: Image-text similarity (0-1)
  - `ocr_text`: Extracted text
  - `has_text_embedding`: Boolean

**Legacy Collection:** `media_embeddings`
- Single vector: 768-dim (ViT)
- Maintained for backward compatibility

### 3. Node.js Integration

**Updated Services:**

1. **VectorEmbeddingService:**
   - `generateMultiModalEmbedding()` - New method
   - `generateImageEmbedding()` - Legacy (still works)

2. **QdrantService:**
   - `upsertMultimodalVector()` - New method
   - `searchSimilarMediaVisual()` - Visual search
   - `searchSimilarMediaText()` - Text search
   - `searchSimilarMediaHybrid()` - Combined search

3. **FeedRankingService:**
   - `buildUserPreferenceVectors()` - Multi-modal preferences
   - `rankPosts()` - Multi-signal ranking

4. **mediaWorker:**
   - Feature flag: `USE_MULTIMODAL_EMBEDDINGS`
   - Automatically uses new endpoints when enabled

### 4. Feed Ranking Algorithm

**Multi-Signal Scoring:**

```typescript
totalScore = 
  visualSimilarity * 0.3 +
  textSimilarity * 0.25 +
  engagementScore * 0.2 +
  recencyScore * 0.15 +
  diversityScore * 0.1
```

**Signal Details:**

1. **Visual Similarity (30%):**
   - CLIP embedding cosine similarity
   - Semantic understanding, not just pixel similarity

2. **Text Similarity (25%):**
   - Caption + OCR text embedding similarity
   - Cross-modal matching

3. **Engagement (20%):**
   - Normalized likes + comments
   - Sigmoid normalization

4. **Recency (15%):**
   - Exponential decay based on age
   - Half-life: 24 hours

5. **Diversity (10%):**
   - Content type variety
   - User variety
   - Prevents echo chambers

## Migration Steps

### Step 1: Deploy Python Service

```bash
cd /home/jnd/python_projects/embedding_sys
docker-compose up -d
```

### Step 2: Update Node.js Configuration

```bash
# .env
USE_MULTIMODAL_EMBEDDINGS=true
EMBEDDING_SERVER_URL=http://localhost:8000
```

### Step 3: Initialize Qdrant Collections

The collections are auto-created on first use, but you can manually initialize:

```typescript
// Run once
import qdrantService from './services/QdrantService';
await qdrantService.ensureMultimodalCollection();
```

### Step 4: Migrate Existing Data (Optional)

```bash
cd /home/jnd/python_projects/embedding_sys
python scripts/migrate_embeddings.py --dry-run
python scripts/migrate_embeddings.py --limit 100  # Test with 100
python scripts/migrate_embeddings.py  # Full migration
```

### Step 5: Enable Feature Flag

```bash
# Gradual rollout
USE_MULTIMODAL_EMBEDDINGS=true
```

### Step 6: Monitor & Adjust

Track metrics:
- Embedding generation success rate
- Feed engagement rates
- Ranking quality metrics

## Backward Compatibility

### Legacy Support

- Old ViT embeddings remain in `media_embeddings` collection
- Legacy endpoints still functional
- Feed ranking can query both collections
- Automatic fallback if new system fails

### Migration Period

During migration:
1. New uploads → New system (if flag enabled)
2. Existing posts → Old system (until migrated)
3. Feed ranking → Queries both collections

## Performance Considerations

### Optimization

1. **Batch Processing:**
   - Process multiple images in parallel
   - Python service handles batching

2. **Caching:**
   - Cache user preference vectors (1 hour TTL)
   - Cache OCR results for repeated queries

3. **GPU Acceleration:**
   - Enable GPU for 3-5x speedup
   - Set `USE_GPU=true` in Python service

### Expected Performance

**Embedding Generation:**
- Image: ~500ms (CPU) / ~100ms (GPU)
- Video: ~5-10s (CPU) / ~2-3s (GPU)

**Feed Ranking:**
- User preference building: ~200-500ms
- Post ranking (100 posts): ~1-2s
- Total feed generation: ~2-3s

## Testing

### Unit Tests

```typescript
// Test multi-modal embedding
const result = await vectorEmbeddingService.generateMultiModalEmbedding(
  imagePath,
  "test caption"
);
expect(result.visual_embedding).toHaveLength(512);
expect(result.text_embedding).toHaveLength(768);
```

### Integration Tests

```typescript
// Test Qdrant storage
await qdrantService.upsertMultimodalVector(
  mediaId,
  visualEmbedding,
  textEmbedding,
  payload
);

// Test retrieval
const vectors = await qdrantService.getMultimodalVectors(mediaId);
expect(vectors.visual).toBeDefined();
```

### A/B Testing

```typescript
// Feature flag for gradual rollout
const useNewRanking = userId % 100 < rolloutPercentage;

if (useNewRanking) {
  // Use new multi-modal ranking
  const ranked = await feedRankingService.rankPosts(...);
} else {
  // Use legacy ranking
  const ranked = await legacyRanking(...);
}
```

## Troubleshooting

### Common Issues

1. **Embedding dimension mismatch:**
   - Verify CLIP model version
   - Check Qdrant collection config

2. **OCR not working:**
   - Check EasyOCR installation
   - Verify image quality
   - Check confidence thresholds

3. **Performance issues:**
   - Enable GPU acceleration
   - Increase batch sizes
   - Add caching

### Debugging

```typescript
// Enable debug logging
process.env.DEBUG = 'true';

// Check model loading
const health = await fetch('http://localhost:8000/health');
console.log(await health.json());
```

## Rollback Plan

If issues occur:

1. **Disable feature flag:**
   ```bash
   USE_MULTIMODAL_EMBEDDINGS=false
   ```

2. **System automatically falls back:**
   - Uses legacy endpoints
   - Queries old collection
   - Legacy ranking algorithm

3. **Fix issues and retry:**
   - Check logs
   - Verify configuration
   - Re-enable flag

## Next Steps

1.  Deploy Python service
2.  Update Node.js integration
3.  Initialize Qdrant collections
4. ⏳ Migrate existing data (optional)
5. ⏳ Enable feature flag
6. ⏳ Monitor metrics
7. ⏳ Gradual rollout
8. ⏳ Full migration

## References

- [Python Service README](../../python_projects/embedding_sys/README.md)
- [Migration Guide](../../python_projects/embedding_sys/MIGRATION_GUIDE.md)
- [Qdrant Named Vectors](https://qdrant.tech/documentation/concepts/collections/#collection-with-multiple-named-vectors)





