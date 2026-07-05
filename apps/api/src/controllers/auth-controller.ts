import type { Request, Response } from 'express';
import { loginRequestSchema, refreshRequestSchema, signupRequestSchema } from '@waos/shared';
import { authService } from '../services/auth-service.js';

// Controllers only translate HTTP in and out; business logic lives in the
// service layer. Invalid bodies throw ZodError, mapped by the error handler.

export const signup = async (req: Request, res: Response): Promise<void> => {
  const input = signupRequestSchema.parse(req.body);
  const result = await authService.signup(input);
  res.status(201).json(result);
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const input = loginRequestSchema.parse(req.body);
  const result = await authService.login(input);
  res.json(result);
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const input = refreshRequestSchema.parse(req.body);
  const result = await authService.refresh(input);
  res.json(result);
};

export const me = async (_req: Request, res: Response): Promise<void> => {
  const result = await authService.me();
  res.json(result);
};
