import type { KnowledgeDocDto } from '@waos/shared';
import type { LLMPort } from '@waos/ports';
import { llmPort } from '../adapters/llm/gemini-adapter.js';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { enqueueEmbeddings } from '../lib/queues.js';
import { knowledgeRepository } from '../repositories/knowledge-repository.js';

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const IMAGE_EXTRACTION_PROMPT = [
  'This photo was uploaded by a small business (a price list, menu, sign, or flyer).',
  'Extract every piece of business information in it as clear plain text:',
  'services, products, prices, opening hours, contact details, locations.',
  'Keep the original language (Swahili or English). Output only the extracted',
  'information with no commentary. If the image contains no readable business',
  'information, output exactly NO_TEXT.',
].join(' ');

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

  async createFromUpload(
    file: { originalname: string; mimetype: string; buffer: Buffer },
    ports: { llm: LLMPort } = { llm: llmPort },
  ): Promise<KnowledgeDocDto> {
    let content: string;
    if (IMAGE_MIME_TYPES.has(file.mimetype)) {
      const completion = await ports.llm.complete({
        system: IMAGE_EXTRACTION_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', mimeType: file.mimetype, data: file.buffer.toString('base64') },
            ],
          },
        ],
        maxTokens: 2048,
        temperature: 0,
      });
      content = completion.text.trim() === 'NO_TEXT' ? '' : completion.text;
    } else if (file.mimetype === 'application/pdf') {
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
      throw new ValidationError('Only .txt, .md, .pdf, and photo (.jpg, .png, .webp) files are supported.');
    }
    if (content.trim().length < 10) {
      throw new ValidationError('This file has no readable text.');
    }
    const title = file.originalname.replace(/\.(txt|md|pdf|jpg|jpeg|png|webp)$/i, '');
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
