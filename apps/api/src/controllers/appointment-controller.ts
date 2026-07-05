import type { Request, Response } from 'express';
import {
  createAppointmentRequestSchema,
  setAppointmentStatusRequestSchema,
  updateAppointmentRequestSchema,
} from '@waos/shared';
import { routeParam } from '../lib/http.js';
import { appointmentService } from '../services/appointment-service.js';

export const create = async (req: Request, res: Response): Promise<void> => {
  const input = createAppointmentRequestSchema.parse(req.body);
  const appointment = await appointmentService.create(input);
  res.status(201).json({ appointment });
};

export const list = async (req: Request, res: Response): Promise<void> => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const appointments = await appointmentService.listWeek(from);
  res.json({ appointments });
};

export const update = async (req: Request, res: Response): Promise<void> => {
  const input = updateAppointmentRequestSchema.parse(req.body);
  const appointment = await appointmentService.reschedule(routeParam(req.params.id), input);
  res.json({ appointment });
};

export const setStatus = async (req: Request, res: Response): Promise<void> => {
  const input = setAppointmentStatusRequestSchema.parse(req.body);
  const appointment = await appointmentService.setStatus(routeParam(req.params.id), input.status);
  res.json({ appointment });
};

export const weeklyStats = async (_req: Request, res: Response): Promise<void> => {
  const stats = await appointmentService.weeklyStats();
  res.json({ stats });
};
