 const ENCODING_PROFILES = {
  video: {
    '240p': {
      width: 426,
      height: 240,
      videoBitrate: '300k',
      audioBitrate: '64k',
      fps: 24,
      preset: 'fast'
    },
    '360p': {
      width: 640,
      height: 360,
      videoBitrate: '500k',
      audioBitrate: '96k',
      fps: 24,
      preset: 'fast'
    },
    '480p': {
      width: 854,
      height: 480,
      videoBitrate: '1000k',
      audioBitrate: '128k',
      fps: 30,
      preset: 'medium'
    },
    '720p': {
      width: 1280,
      height: 720,
      videoBitrate: '2500k',
      audioBitrate: '128k',
      fps: 30,
      preset: 'medium'
    },
    '1080p': {
      width: 1920,
      height: 1080,
      videoBitrate: '5000k',
      audioBitrate: '192k',
      fps: 30,
      preset: 'slow'
    },
    '1440p': {
      width: 2560,
      height: 1440,
      videoBitrate: '10000k',
      audioBitrate: '192k',
      fps: 60,
      preset: 'slow'
    }
  },
  
  thumbnail: {
    small: { width: 150, height: 150 },
    medium: { width: 320, height: 240 },
    large: { width: 640, height: 480 }
  },
  
  image: {
    small: { width: 400, quality: 80 },
    medium: { width: 800, quality: 85 },
    large: { width: 1600, quality: 90 },
    original: { quality: 95 }
  }
};

 const SUPPORTED_FORMATS = {
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  audio: ['mp3', 'wav', 'aac', 'm4a', 'ogg']
};

 const OUTPUT_CONTAINERS = ['mp4', 'webm'];
 const VIDEO_CODEC = 'libx264'; // or 'libvpx-vp9' for webm
 const AUDIO_CODEC = 'aac';

 export { ENCODING_PROFILES, SUPPORTED_FORMATS, OUTPUT_CONTAINERS, VIDEO_CODEC, AUDIO_CODEC };