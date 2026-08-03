import { Router } from 'express';
import * as supplierController from '../controllers/supplier-controller.js';
import { requireAuth } from '../middleware/auth.js';
import { requireModule } from '../middleware/require-module.js';

export const supplierRoutes: Router = Router();

supplierRoutes.use(requireAuth);
supplierRoutes.use(requireModule('sourcing'));
supplierRoutes.post('/', supplierController.create);
supplierRoutes.get('/', supplierController.list);
supplierRoutes.patch('/:id', supplierController.update);
supplierRoutes.delete('/:id', supplierController.remove);
