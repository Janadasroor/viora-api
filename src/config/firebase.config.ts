import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

const __dirname = path.resolve();

// Check if Firebase is enabled via env
const isFirebaseEnabled = process.env.USE_FIREBASE === 'true';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let storage: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let bucket: any = null;

if (isFirebaseEnabled) {
  // Initialize Firebase Admin
  if (!admin.apps.length) {
    try {
      let serviceAccount: any = null;

      // 1. Try Environment Variables first
      if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
        serviceAccount = {
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          projectId: process.env.FIREBASE_PROJECT_ID,
        };
      }
      // 2. Try JSON file if no env vars
      else {
        const possiblePaths = [
          path.join(process.cwd(), 'src/config/viora-firebase-adminsdk.json'),
          path.join(process.cwd(), 'config/viora-firebase-adminsdk.json'),
          path.join(__dirname, 'viora-firebase-adminsdk.json')
        ];

        let serviceAccountPath = '';
        for (const p of possiblePaths) {
          if (fs.existsSync(p)) {
            serviceAccountPath = p;
            break;
          }
        }

        if (serviceAccountPath) {
          serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
        }
      }

      const firebaseConfig: any = {
        projectId: process.env.FIREBASE_PROJECT_ID || 'viora-887d7',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'viora-887d7.firebasestorage.app',
      };

      if (serviceAccount) {
        firebaseConfig.credential = admin.credential.cert(serviceAccount);
      } else {
        console.warn('⚠️ No credentials found, initializing with default/ADC credentials');
      }

      admin.initializeApp(firebaseConfig);

      // Force Emulator in Development
      if (process.env.NODE_ENV === 'development') {
        process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
      }

    } catch (error) {
      console.error(' Error initializing Firebase Admin:', error);
      // Fallback
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'viora-887d7',
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'viora-887d7.firebasestorage.app',
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage = admin.storage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bucket = storage.bucket();
} else {
}

export { admin, bucket, isFirebaseEnabled };
