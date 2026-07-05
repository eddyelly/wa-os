import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import argon2 from 'argon2';
import { requireRequestContext } from '../lib/context.js';
import { ConflictError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

/**
 * Staff invites without an email service: the owner gets a one-time
 * temporary password to hand over in person or on WhatsApp. Self-serve
 * password reset emails are explicitly out of Phase 1 scope.
 */
export async function inviteStaff(input: {
  name: string;
  email: string;
}): Promise<{ id: string; name: string; email: string; temporaryPassword: string }> {
  const { organizationId } = requireRequestContext();
  const temporaryPassword = `Waos-${randomBytes(6).toString('base64url')}`;
  const passwordHash = await argon2.hash(temporaryPassword);
  try {
    const user = await prisma.user.create({
      data: {
        organizationId,
        name: input.name,
        email: input.email,
        passwordHash,
        role: 'STAFF',
      },
    });
    return { id: user.id, name: user.name, email: user.email, temporaryPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('An account with this email already exists.');
    }
    throw error;
  }
}
