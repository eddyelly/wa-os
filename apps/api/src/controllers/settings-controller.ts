import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireRequestContext } from '../lib/context.js';
import { NotFoundError } from '../lib/errors.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { runAiTest } from '../services/ai-test-service.js';
import { dashboardSummary } from '../services/dashboard-service.js';
import { inviteStaff } from '../services/team-service.js';

const inviteStaffRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
});

const aiSettingsRequestSchema = z.object({
  aiConfidenceThreshold: z.number().min(0.1).max(0.95).optional(),
  toneNotes: z.string().trim().max(1000).optional(),
});

const aiTestRequestSchema = z.object({
  question: z.string().trim().min(2).max(1000),
});

export const invite = async (req: Request, res: Response): Promise<void> => {
  const input = inviteStaffRequestSchema.parse(req.body);
  const result = await inviteStaff(input);
  res.status(201).json({ user: result });
};

export const updateAiSettings = async (req: Request, res: Response): Promise<void> => {
  const input = aiSettingsRequestSchema.parse(req.body);
  const { organizationId } = requireRequestContext();
  const organization = await organizationRepository.findCurrent(organizationId);
  if (!organization) {
    throw new NotFoundError('Your business could not be found.');
  }
  const settings =
    typeof organization.settings === 'object' && organization.settings !== null
      ? (organization.settings as Record<string, unknown>)
      : {};
  const updated = await organizationRepository.update(organizationId, {
    settings: {
      ...settings,
      ...(input.aiConfidenceThreshold !== undefined
        ? { aiConfidenceThreshold: input.aiConfidenceThreshold }
        : {}),
      ...(input.toneNotes !== undefined ? { toneNotes: input.toneNotes } : {}),
    },
  });
  res.json({ settings: updated.settings });
};

export const aiTest = async (req: Request, res: Response): Promise<void> => {
  const input = aiTestRequestSchema.parse(req.body);
  const result = await runAiTest(input.question);
  res.json({ result });
};

export const dashboard = async (_req: Request, res: Response): Promise<void> => {
  const summary = await dashboardSummary();
  res.json({ summary });
};
