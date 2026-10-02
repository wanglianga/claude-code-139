import { CanActivate, ExecutionContext, Injectable, SetMetadata, applyDecorators, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtUser } from './auth.service';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: JwtUser['role'][]) => applyDecorators(SetMetadata(ROLES_KEY, roles));

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth: string | undefined = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) return false;
    try {
      req.user = await this.jwt.verifyAsync<JwtUser>(auth.slice(7));
    } catch {
      return false;
    }
    const roles = this.reflector.getAllAndOverride<JwtUser['role'][]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && roles.length > 0 && !roles.includes(req.user.role)) return false;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data, ctx): JwtUser => {
  return ctx.switchToHttp().getRequest().user;
});
