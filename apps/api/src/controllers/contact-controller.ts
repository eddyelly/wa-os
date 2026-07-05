import type { Request, Response } from 'express';
import { z } from 'zod';
import { routeParam } from '../lib/http.js';
import { NotFoundError } from '../lib/errors.js';
import { contactRepository } from '../repositories/contact-repository.js';

const updateContactRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional(),
  language: z.enum(['sw', 'en']).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  customFields: z.record(z.string(), z.string().max(500)).optional(),
});

function toDto(contact: {
  id: string;
  phone: string;
  name: string | null;
  language: string | null;
  tags: string[];
  optedInAt: Date | null;
  customFields: unknown;
}) {
  return {
    id: contact.id,
    phone: contact.phone,
    name: contact.name,
    language: contact.language,
    tags: contact.tags,
    optedInAt: contact.optedInAt,
    customFields: contact.customFields,
  };
}

export const list = async (req: Request, res: Response): Promise<void> => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined;
  const contacts = await contactRepository.list({ search, tag });
  res.json({ contacts: contacts.map(toDto) });
};

export const optIn = async (req: Request, res: Response): Promise<void> => {
  const id = routeParam(req.params.id);
  const contact = await contactRepository.findById(id);
  if (!contact) {
    throw new NotFoundError('This customer no longer exists.');
  }
  const updated = await contactRepository.setOptedIn(id);
  res.json({ contact: toDto(updated) });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const input = updateContactRequestSchema.parse(req.body);
  const id = routeParam(req.params.id);
  const contact = await contactRepository.findById(id);
  if (!contact) {
    throw new NotFoundError('This customer no longer exists.');
  }
  const updated = await contactRepository.update(id, input);
  res.json({ contact: toDto(updated) });
};
