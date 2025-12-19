import { prisma } from '../core/prisma';
import type { User, Prisma } from '@prisma/client';

/**
 * osu! profile data from OAuth
 */
export interface OsuProfile {
  id: number;
  username: string;
  country_code: string;
  avatar_url: string;
}

/**
 * Repository for user database operations
 * Handles user creation, lookup, and OAuth profile syncing
 */
export class UserRepository {
  /**
   * Find user by osu! ID
   * @param osuId osu! user ID
   * @returns User or null if not found
   */
  async findByOsuId(osuId: number): Promise<User | null> {
    return prisma.user.findUnique({
      where: { osuId },
    });
  }

  /**
   * Find user by osu! username
   * @param username osu! username (case-insensitive)
   * @returns User or null if not found
   */
  async findByOsuUsername(username: string): Promise<User | null> {
    return prisma.user.findFirst({
      where: {
        osuUsername: {
          equals: username,
          mode: 'insensitive',
        },
      },
    });
  }

  /**
   * Find user by database ID
   * @param userId Database user ID
   * @returns User or null if not found
   */
  async findById(userId: number): Promise<User | null> {
    return prisma.user.findUnique({
      where: { id: userId },
    });
  }

  /**
   * Create or update user from osu! OAuth profile
   * @param osuProfile osu! profile data
   * @returns Created or updated user
   */
  async upsertFromOAuth(osuProfile: OsuProfile): Promise<User> {
    return prisma.user.upsert({
      where: { osuId: osuProfile.id },
      update: {
        osuUsername: osuProfile.username,
        countryCode: osuProfile.country_code,
        avatarUrl: osuProfile.avatar_url,
        lastLoginAt: new Date(),
      },
      create: {
        osuId: osuProfile.id,
        osuUsername: osuProfile.username,
        countryCode: osuProfile.country_code,
        avatarUrl: osuProfile.avatar_url,
        role: 'PLAYER',
      },
    });
  }

  /**
   * Update user role
   * @param userId User ID
   * @param role New role
   * @returns Updated user
   */
  async updateRole(userId: number, role: 'PLAYER' | 'MODERATOR' | 'ADMIN'): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data: { role },
    });
  }

  /**
   * Find all users with a specific role
   * @param role Role to filter by
   * @returns List of users with the role
   */
  async findByRole(role: 'PLAYER' | 'MODERATOR' | 'ADMIN'): Promise<User[]> {
    return prisma.user.findMany({
      where: { role },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Create new user
   * @param data User creation data
   * @returns Created user
   */
  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({
      data,
    });
  }

  /**
   * Update user
   * @param userId User ID
   * @param data User update data
   * @returns Updated user
   */
  async update(userId: number, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({
      where: { id: userId },
      data,
    });
  }
}

// Singleton export
export const userRepository = new UserRepository();
