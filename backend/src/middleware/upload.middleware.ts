import multer from 'multer';

// Configure multer memory storage
const storage = multer.memoryStorage();

// File filter for images and documents
const fileFilter = (
  _req: Express.Request,  // ✅ Prefixed with _ to indicate intentionally unused
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} is not allowed`));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5, // Max 5 files per request
  },
});

export const uploadSingle = upload.single('file');
export const uploadMultiple = upload.array('files', 5);

export default upload;