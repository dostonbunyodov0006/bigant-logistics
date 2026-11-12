import { forgetAccount } from '../common/active-account';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import {
  DEFAULT_PAGE_SIZE,
  type CreateUserInput,
  type Page,
  type Role,
  type UpdateUserInput,
  type UserFilterInput,
  type UserPublic,
  type UserStatus,
} from '@bigant/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByPhone(phoneNumber: string) {
    return this.prisma.user.findUnique({ where: { phoneNumber } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  private buildWhere(role?: Role, search?: string, status?: 'active' | 'inactive') {
    const q = search?.trim();
    return {
      ...(role ? { role } : {}),
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { phoneNumber: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
  }

  /** Bounded: this used to return every user. */
  async list(role?: Role, filters: UserFilterInput = {}): Promise<UserPublic[]> {
    const users = await this.prisma.user.findMany({
      where: this.buildWhere(role, filters.search, filters.status),
      orderBy: { createdAt: 'desc' },
      skip: filters.skip ?? 0,
      take: filters.take ?? DEFAULT_PAGE_SIZE,
    });
    return users.map((u) => this.toPublic(u));
  }

  async listPage(role: Role | undefined, filters: UserFilterInput): Promise<Page<UserPublic>> {
    const where = this.buildWhere(role, filters.search, filters.status);
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? DEFAULT_PAGE_SIZE,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: users.map((u) => this.toPublic(u)), total };
  }

  async getPublicById(id: string): Promise<UserPublic> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.toPublic(user);
  }

  async create(input: CreateUserInput, actorRole: Role): Promise<UserPublic> {
    // The guard lets a dispatcher through admin routes; making an admin or
    // another dispatcher stays the admin's (audit, 07.11.2026).
    if ((input.role === 'admin' || input.role === 'manager') && actorRole !== 'admin') {
      throw new ForbiddenException('admin_only');
    }
    const existing = await this.findByPhone(input.phone_number);
    if (existing) {
      throw new ConflictException('Phone number already registered');
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        phoneNumber: input.phone_number,
        passwordHash,
        role: input.role,
        telegramId: input.telegram_id ?? null,
      },
    });
    return this.toPublic(user);
  }

  /** Update a managed user (seller, dispatcher or admin). */
  async update(id: string, input: UpdateUserInput, actorRole: Role = 'admin'): Promise<UserPublic> {
    const user = await this.getManageableOrThrow(id);
    this.assertMayTouch(user, actorRole);
    if (input.status === 'inactive') await this.assertNotLastAdmin(user);
    if (input.phone_number && input.phone_number !== user.phoneNumber) {
      const existing = await this.findByPhone(input.phone_number);
      if (existing && existing.id !== id) {
        throw new ConflictException('phone_already_registered');
      }
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.phone_number !== undefined && { phoneNumber: input.phone_number }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.telegram_id !== undefined && { telegramId: input.telegram_id }),
        ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 10) } : {}),
      },
    });
    forgetAccount(id);
    return this.toPublic(updated);
  }

  /** Soft-delete: deactivate the account (blocks login, preserves history). */
  async deactivate(id: string, actorRole: Role = 'admin'): Promise<UserPublic> {
    const user = await this.getManageableOrThrow(id);
    this.assertMayTouch(user, actorRole);
    await this.assertNotLastAdmin(user);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: 'inactive' },
    });
    forgetAccount(id); // out at once, not in 20 s
    return this.toPublic(updated);
  }

  /** A dispatcher cannot switch an admin or another dispatcher off or on (owner, 29.10.2026 / 07.11.2026). */
  private assertMayTouch(user: User, actorRole: Role): void {
    if (user.role === 'admin' && actorRole !== 'admin') throw new ForbiddenException('admins_only');
    // A dispatcher (manager) is switched on/off, edited or removed by an admin
    // only — the same rule as creating one (owner, 07.11.2026).
    if (user.role === 'manager' && actorRole !== 'admin') throw new ForbiddenException('admin_only');
  }

  /** The office must always have a way in: the last active admin stays. */
  private async assertNotLastAdmin(user: User): Promise<void> {
    if (user.role !== 'admin' || user.status !== 'active') return;
    const others = await this.prisma.user.count({ where: { role: 'admin', status: 'active', id: { not: user.id } } });
    if (others === 0) throw new ForbiddenException('last_admin');
  }

  /** Loads a user and guards that it is managed here: sellers, dispatchers, admins. */
  private async getManageableOrThrow(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role === 'driver') {
      // Drivers are managed via the drivers endpoints (they have a Driver profile).
      throw new ForbiddenException('use_drivers_endpoint');
    }
    return user;
  }

  private toPublic(user: User): UserPublic {
    return {
      id: user.id,
      name: user.name,
      phone_number: user.phoneNumber,
      role: user.role as Role,
      status: user.status as UserStatus,
      telegram_id: user.telegramId,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    };
  }
}
