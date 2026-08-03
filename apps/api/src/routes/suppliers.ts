import { Router, type Request } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import * as supplierController from '../controllers/supplier-controller.js';
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

export const supplierRoutes: Router = Router();

supplierRoutes.use(requireAuth);
supplierRoutes.use(requireModule('sourcing'));
supplierRoutes.post('/', supplierController.create);
supplierRoutes.get('/', supplierController.list);
supplierRoutes.post('/import', csvUpload.single('file'), supplierController.importSuppliers);
supplierRoutes.patch('/:id', supplierController.update);
supplierRoutes.delete('/:id', supplierController.remove);
supplierRoutes.get('/:supplierId/items', supplierController.listItems);
supplierRoutes.post('/:supplierId/items', supplierController.createItem);
supplierRoutes.post(
  '/:supplierId/items/import',
  csvUpload.single('file'),
  supplierController.importItems,
);
supplierRoutes.patch('/:supplierId/items/:itemId', supplierController.updateItem);
supplierRoutes.delete('/:supplierId/items/:itemId', supplierController.removeItem);
supplierRoutes.post(
  '/:supplierId/items/:itemId/images',
  upload.single('file'),
  supplierController.addItemImage,
);
supplierRoutes.delete(
  '/:supplierId/items/:itemId/images/:imageId',
  supplierController.removeItemImage,
);
