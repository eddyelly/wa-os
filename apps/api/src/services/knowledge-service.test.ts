import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocDto } from '@waos/shared';
import type { LLMPort } from '@waos/ports';
import { ValidationError } from '../lib/errors.js';
import { knowledgeService } from './knowledge-service.js';

const savedDoc: KnowledgeDocDto = {
  id: 'doc_1',
  title: 'price-list',
  mimeType: 'image/jpeg',
  chunkCount: 0,
  embeddedCount: 0,
  createdAt: new Date('2026-08-01T00:00:00Z'),
};

function fakeLlm(text: string): { port: LLMPort; complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn().mockResolvedValue({ text });
  return { port: { complete }, complete };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('knowledge upload from images', () => {
  it('extracts image text through the llm port and saves it', async () => {
    const createFromText = vi
      .spyOn(knowledgeService, 'createFromText')
      .mockResolvedValue(savedDoc);
    const { port, complete } = fakeLlm('Kusuka rasta TZS 25,000. Tunafungua 9:00 mpaka 19:00.');
    const buffer = Buffer.from('fake-image-bytes');

    const doc = await knowledgeService.createFromUpload(
      { originalname: 'price-list.jpg', mimetype: 'image/jpeg', buffer },
      { llm: port },
    );

    const call = complete.mock.calls[0]?.[0] as { system: string; messages: unknown };
    expect(call.system).toContain('NO_TEXT');
    expect(call.messages).toEqual([
      {
        role: 'user',
        content: [{ type: 'image', mimeType: 'image/jpeg', data: buffer.toString('base64') }],
      },
    ]);
    expect(createFromText).toHaveBeenCalledWith(
      'price-list',
      'Kusuka rasta TZS 25,000. Tunafungua 9:00 mpaka 19:00.',
      'image/jpeg',
    );
    expect(doc).toBe(savedDoc);
  });

  it('rejects an image with no readable text', async () => {
    const { port } = fakeLlm('NO_TEXT');
    await expect(
      knowledgeService.createFromUpload(
        { originalname: 'blurry.png', mimetype: 'image/png', buffer: Buffer.from('x') },
        { llm: port },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects unsupported file types without calling the llm', async () => {
    const { port, complete } = fakeLlm('anything');
    await expect(
      knowledgeService.createFromUpload(
        { originalname: 'virus.exe', mimetype: 'application/octet-stream', buffer: Buffer.from('x') },
        { llm: port },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(complete).not.toHaveBeenCalled();
  });
});
