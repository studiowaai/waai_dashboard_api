import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthedUser {
  userId: string;
  orgId: string;
  role: string;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
