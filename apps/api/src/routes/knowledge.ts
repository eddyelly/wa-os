import { Router } from 'express';
import multer from 'multer';
import * as knowledgeController from '../controllers/knowledge-controller.js';
import { requireAuth } from '../middleware/auth.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const knowledgeRoutes: Router = Router();

knowledgeRoutes.use(requireAuth);
knowledgeRoutes.post('/', knowledgeController.create);
knowledgeRoutes.post('/upload', upload.single('file'), knowledgeController.upload);
knowledgeRoutes.get('/', knowledgeController.list);
knowledgeRoutes.delete('/:id', knowledgeController.remove);
