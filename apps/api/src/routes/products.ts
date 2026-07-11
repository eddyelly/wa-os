import { Router } from 'express';
import * as productController from '../controllers/product-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireModule } from '../middleware/require-module.js';

export const productRoutes: Router = Router();

productRoutes.use(requireAuth);
productRoutes.use(requireModule('shop'));
productRoutes.post('/', productController.create);
productRoutes.get('/', productController.list);
productRoutes.patch('/:id', productController.update);
productRoutes.delete('/:id', productController.remove);
