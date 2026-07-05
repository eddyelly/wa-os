import type { Request, Response } from 'express';
import { createKnowledgeDocRequestSchema } from '@waos/shared';
import { routeParam } from '../lib/http.js';
import { ValidationError } from '../lib/errors.js';
import { knowledgeService } from '../services/knowledge-service.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const input = createKnowledgeDocRequestSchema.parse(req.body);
  const doc = await knowledgeService.createFromText(input.title, input.content);
  res.status(201).json({ doc });
};

export const upload = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;
  if (!file) {
    throw new ValidationError('Attach a .txt, .md, or .pdf file.');
  }
  const doc = await knowledgeService.createFromUpload({
    originalname: file.originalname,
    mimetype: file.mimetype,
    buffer: file.buffer,
  });
  res.status(201).json({ doc });
};

export const list = async (_req: Request, res: Response): Promise<void> => {
  const docs = await knowledgeService.list();
  res.json({ docs });
};

export const remove = async (req: Request, res: Response): Promise<void> => {
  await knowledgeService.remove(routeParam(req.params.id));
  res.json({ ok: true });
};
