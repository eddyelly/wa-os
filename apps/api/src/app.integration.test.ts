// End-to-end auth round trip against a live database. Gated on
// INTEGRATION_DATABASE_URL, which the test setup also uses as DATABASE_URL
// so the app under test hits the same migrated database.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { apiErrorSchema, authResponseSchema } from '@waos/shared';
import { createApp } from './app.js';
import { basePrisma } from './lib/prisma.js';

const databaseUrl = process.env.INTEGRATION_DATABASE_URL;

const parseAuth = (body: unknown) => authResponseSchema.parse(body);
const parseError = (body: unknown) => apiErrorSchema.parse(body);
const meResponseSchema = authResponseSchema.pick({ user: true, organization: true });

describe.skipIf(!databaseUrl)('auth flow (live database)', () => {
  const app = createApp();

  const email = `owner-${randomUUID()}@example.test`;
  const password = 'StrongPass123!';
  const signupBody = {
    businessName: 'Checkpoint Salon',
    vertical: 'salon',
    language: 'sw',
    timezone: 'Africa/Dar_es_Salaam',
    name: 'Checkpoint Owner',
    email,
    password,
  };

  afterAll(async () => {
    const user = await basePrisma.user.findUnique({ where: { email } });
    if (user) {
      await basePrisma.organization.delete({ where: { id: user.organizationId } });
    }
    await basePrisma.$disconnect();
  });

  it('signs up a business: organization and OWNER user in one shot', async () => {
    const response = await request(app).post('/api/v1/auth/signup').send(signupBody);
    expect(response.status).toBe(201);
    const auth = parseAuth(response.body as unknown);
    expect(auth.user.role).toBe('OWNER');
    expect(auth.organization.name).toBe('Checkpoint Salon');
    expect(auth.tokens.accessToken).toBeTruthy();
    expect(auth.tokens.refreshToken).toBeTruthy();
    const rawUser = (response.body as { user: Record<string, unknown> }).user;
    expect(rawUser.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate signup with a conflict', async () => {
    const response = await request(app).post('/api/v1/auth/signup').send(signupBody);
    expect(response.status).toBe(409);
    expect(parseError(response.body as unknown).error.code).toBe('CONFLICT');
  });

  it('logs in and reaches a protected route with the access token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    expect(login.status).toBe(200);
    const auth = parseAuth(login.body as unknown);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${auth.tokens.accessToken}`);
    expect(me.status).toBe(200);
    const meBody = meResponseSchema.parse(me.body as unknown);
    expect(meBody.user.email).toBe(email);
    expect(meBody.organization.name).toBe('Checkpoint Salon');
  });

  it('rejects a bad password', async () => {
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPass123!' });
    expect(login.status).toBe(401);
    expect(parseError(login.body as unknown).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects protected routes without a token', async () => {
    const me = await request(app).get('/api/v1/auth/me');
    expect(me.status).toBe(401);
  });

  it('refreshes the token pair with a refresh token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const auth = parseAuth(login.body as unknown);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: auth.tokens.refreshToken });
    expect(refresh.status).toBe(200);
    const refreshed = parseAuth(refresh.body as unknown);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.tokens.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('rejects an access token used as a refresh token', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email, password });
    const auth = parseAuth(login.body as unknown);
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: auth.tokens.accessToken });
    expect(refresh.status).toBe(401);
  });

  it('validates the signup body with Zod', async () => {
    const response = await request(app)
      .post('/api/v1/auth/signup')
      .send({ email: 'not-an-email', password: 'short' });
    expect(response.status).toBe(400);
    expect(parseError(response.body as unknown).error.code).toBe('VALIDATION_ERROR');
  });
});
