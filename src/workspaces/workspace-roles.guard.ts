import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Decorator to set required workspace roles on a controller method.
 * Usage: @RequireRoles('owner', 'admin')
 */
export const ROLES_KEY = 'workspace_roles';
export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Guard that checks the user's role within their workspace.
 * If @RequireRoles is not set, any authenticated user passes.
 * If @RequireRoles('owner', 'admin') is set, only those roles pass.
 */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles specified, allow any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.userId || !user?.orgId) {
      throw new ForbiddenException('Niet geautoriseerd');
    }

    // Look up the user's role in the workspace
    const result = await this.dataSource.query(
      `SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`,
      [user.orgId, user.userId],
    );

    if (!result || result.length === 0) {
      throw new ForbiddenException('Je bent geen lid van deze workspace');
    }

    const userRole = result[0].role;

    if (!requiredRoles.includes(userRole)) {
      throw new ForbiddenException(
        `Je hebt geen toegang. Vereiste rol: ${requiredRoles.join(' of ')}`,
      );
    }

    // Attach workspace role to request for downstream use
    request.user.workspaceRole = userRole;

    return true;
  }
}
