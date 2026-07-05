import type { KnowledgeDocDto } from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { enqueueEmbeddings } from '../lib/queues.js';
import { knowledgeRepository } from '../repositories/knowledge-repository.js';

export const knowledgeService = {
  async createFromText(title: string, content: string, mimeType = 'text/plain'): Promise<KnowledgeDocDto> {
    const doc = await knowledgeRepository.createDoc({ title, content, mimeType });
    await enqueueEmbeddings({
      organizationId: requireRequestContext().organizationId,
      docId: doc.id,
    });
    return {
      id: doc.id,
      title: doc.title,
      mimeType: doc.mimeType,
      chunkCount: 0,
      embeddedCount: 0,
      createdAt: doc.createdAt,
    };
  },

  async createFromUpload(file: { originalname: string; mimetype: string; buffer: Buffer }): Promise<KnowledgeDocDto> {
    let content: string;
    if (file.mimetype === 'application/pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      try {
        const parsed = await parser.getText();
        content = parsed.text;
      } finally {
        await parser.destroy();
      }
    } else if (
      file.mimetype.startsWith('text/') ||
      file.originalname.endsWith('.md') ||
      file.originalname.endsWith('.txt')
    ) {
      content = file.buffer.toString('utf8');
    } else {
      throw new ValidationError('Only .txt, .md, and .pdf files are supported.');
    }
    if (content.trim().length < 10) {
      throw new ValidationError('This file has no readable text.');
    }
    const title = file.originalname.replace(/\.(txt|md|pdf)$/i, '');
    return this.createFromText(title, content, file.mimetype);
  },

  async list(): Promise<KnowledgeDocDto[]> {
    const docs = await knowledgeRepository.listDocs();
    const embedded = await knowledgeRepository.countEmbeddedByDoc(docs.map((doc) => doc.id));
    return docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      mimeType: doc.mimeType,
      chunkCount: doc._count.chunks,
      embeddedCount: embedded.get(doc.id) ?? 0,
      createdAt: doc.createdAt,
    }));
  },

  async remove(id: string): Promise<void> {
    const doc = await knowledgeRepository.findDocById(id);
    if (!doc) {
      throw new NotFoundError('This document no longer exists.');
    }
    await knowledgeRepository.deleteDoc(id);
  },
};
