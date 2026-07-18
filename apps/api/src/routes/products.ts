import { Router, type Request } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import * as productController from '../controllers/product-controller.js';
import { ValidationError } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { requireModule } from '../middleware/require-module.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file, callback: FileFilterCallback) => {
    if (!file.mimetype.startsWith('image/')) {
      callback(new ValidationError('Attach an image file.'));
      return;
    }
    callback(null, true);
  },
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (_req: Request, file, callback: FileFilterCallback) => {
    const isCsv =
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.toLowerCase().endsWith('.csv');
    if (!isCsv) {
      callback(new ValidationError('Attach a .csv file.'));
      return;
    }
    callback(null, true);
  },
});

export const productRoutes: Router = Router();

productRoutes.use(requireAuth);
productRoutes.use(requireModule('shop'));
productRoutes.post('/', productController.create);
productRoutes.get('/', productController.list);
productRoutes.post('/import', csvUpload.single('file'), productController.importCsv);
productRoutes.patch('/:id', productController.update);
productRoutes.delete('/:id', productController.remove);
productRoutes.post('/:id/images', upload.single('file'), productController.addImage);
productRoutes.delete('/:id/images/:imageId', productController.removeImage);
