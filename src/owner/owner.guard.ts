import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

export interface OwnerJwtPayload {
  staffId: string;
  businessId: string;
  phone: string;
}

@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const auth = request.headers['authorization'] as string;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;

    if (!token) throw new UnauthorizedException('Token requerido');

    try {
      const secret = process.env.OWNER_JWT_SECRET ?? 'ovapy-owner-secret';
      const payload = jwt.verify(token, secret) as OwnerJwtPayload;
      (request as any).owner = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
  }
}
