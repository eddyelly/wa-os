import { Prisma, type Organization, type User } from '@prisma/client';
import argon2 from 'argon2';
import type {
  AuthResponse,
  BusinessModule,
  LoginRequest,
  RefreshRequest,
  SignupRequest,
} from '@waos/shared';
import { requireRequestContext } from '../lib/context.js';
import { ConflictError, NotFoundError, UnauthorizedError } from '../lib/errors.js';
import { signAccessToken, signRefreshToken, verifyToken, type TokenSubject } from '../lib/jwt.js';
import { basePrisma } from '../lib/prisma.js';
import { organizationRepository } from '../repositories/organization-repository.js';
import { userRepository } from '../repositories/user-repository.js';

function toAuthResponse(user: User, organization: Organization): AuthResponse {
  const subject: TokenSubject = {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };
  return {
    user: {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      role: user.role,
    },
    organization: {
      id: organization.id,
      name: organization.name,
      vertical: organization.vertical,
      language: organization.language,
      timezone: organization.timezone,
      modules: organization.modules as BusinessModule[],
    },
    tokens: {
      accessToken: signAccessToken(subject),
      refreshToken: signRefreshToken(subject),
    },
  };
}

export const authService = {
  /**
   * Signup IS the "save your business" moment: the Organization and its
   * OWNER User are created in a single transaction.
   */
  async signup(input: SignupRequest): Promise<AuthResponse> {
    const passwordHash = await argon2.hash(input.password);
    try {
      const { user, organization } = await basePrisma.$transaction(async (tx) => {
        const organization = await organizationRepository.create(tx, {
          name: input.businessName,
          vertical: input.vertical,
          language: input.language,
          timezone: input.timezone,
        });
        const user = await userRepository.createOwner(tx, {
          organizationId: organization.id,
          email: input.email,
          passwordHash,
          name: input.name,
        });
        return { user, organization };
      });
      return toAuthResponse(user, organization);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('An account with this email already exists. Log in instead.');
      }
      throw error;
    }
  },

  async login(input: LoginRequest): Promise<AuthResponse> {
    const user = await userRepository.findByEmailPreAuth(input.email);
    const invalidCredentials = new UnauthorizedError('Email or password is incorrect.');
    if (!user) {
      // Verify against a throwaway hash so response timing does not reveal
      // whether the email exists.
      await argon2.verify(await argon2.hash('invalid-password'), input.password).catch(() => false);
      throw invalidCredentials;
    }
    const passwordMatches = await argon2.verify(user.passwordHash, input.password);
    if (!passwordMatches) {
      throw invalidCredentials;
    }
    const organization = await organizationRepository.findByIdPreAuth(user.organizationId);
    if (!organization) {
      throw invalidCredentials;
    }
    return toAuthResponse(user, organization);
  },

  /** Rotates the pair: a refresh yields a new access AND refresh token. */
  async refresh(input: RefreshRequest): Promise<AuthResponse> {
    const subject = verifyToken(input.refreshToken, 'refresh');
    const user = await userRepository.findByIdPreAuth(subject.userId);
    if (!user || user.organizationId !== subject.organizationId) {
      throw new UnauthorizedError('Your session is invalid or has expired. Log in again.');
    }
    const organization = await organizationRepository.findByIdPreAuth(user.organizationId);
    if (!organization) {
      throw new UnauthorizedError('Your session is invalid or has expired. Log in again.');
    }
    return toAuthResponse(user, organization);
  },

  /** Runs inside the request context; reads go through the tenant client. */
  async me(): Promise<Pick<AuthResponse, 'user' | 'organization'>> {
    const context = requireRequestContext();
    const user = await userRepository.findById(context.userId);
    if (!user) {
      throw new NotFoundError('Your account could not be found.');
    }
    const organization = await organizationRepository.findCurrent(user.organizationId);
    if (!organization) {
      throw new NotFoundError('Your business could not be found.');
    }
    return {
      user: {
        id: user.id,
        organizationId: user.organizationId,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      organization: {
        id: organization.id,
        name: organization.name,
        vertical: organization.vertical,
        language: organization.language,
        timezone: organization.timezone,
        modules: organization.modules as BusinessModule[],
      },
    };
  },
};
