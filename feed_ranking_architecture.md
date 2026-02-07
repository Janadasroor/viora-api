```mermaid
graph TB
    A[Post Upload] --> B{Content Type Detection}
    
    B -->|Image/Meme| C[Image Processing Pipeline]
    B -->|Text Only| D[Text Processing Pipeline]
    B -->|Video| E[Video Processing Pipeline]
    
    C --> C1[OCR Extraction]
    C --> C2[CLIP Embedding]
    C --> C3[Image Classification]
    C --> C4[NSFW Check]
    
    C1 --> F[Text Embedding]
    D --> F
    
    C2 --> G[Vector Database]
    C3 --> G
    F --> G
    
    E --> E1[Frame Sampling]
    E1 --> C2
    
    G --> H[Semantic Index]
    
    I[User Profile] --> J[Interest Embeddings]
    J --> K[Feed Generation Service]
    
    H --> K
    
    K --> L[Candidate Retrieval]
    L --> M[Semantic Scoring]
    M --> N[Ranking Model]
    N --> O[Diversity Re-ranking]
    O --> P[Final Feed]
    
    Q[User Interactions] --> R[Engagement Tracking]
    R --> J
    R --> S[Model Retraining]
    
    style C fill:#e1f5ff
    style F fill:#ffe1f5
    style K fill:#f5ffe1
    style N fill:#fff5e1
