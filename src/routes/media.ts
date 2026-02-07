import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import mediaController from '../controllers/MediaController.js';
import { validate } from '../middleware/validation.js';
import { mediaSchemas } from '../validators/schemas/index.js';

const router = Router();

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve('uploads/images'));      // folder to store files
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve('uploads/videos'));      // folder to store files
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const videosUpload = multer({ storage: videoStorage });
const imagesUpload = multer({ storage: imageStorage });

router.post("/upload/image", imagesUpload.array('image', 15), validate(mediaSchemas.uploadImagesSchema), mediaController.uploadImages);
router.post("/upload/video", videosUpload.array('video', 15), validate(mediaSchemas.uploadVideoSchema), mediaController.uploadVideo);
router.get("/", validate(mediaSchemas.getMediaSchema), mediaController.getMedia);
router.delete("/delete/:id", validate(mediaSchemas.deleteMediaSchema), mediaController.deleteFile);

export default router;