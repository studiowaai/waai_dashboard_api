import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { FastifyRequest } from 'fastify';
import { JwtPayload } from './auth.service';

const COOKIE_NAME = 'session';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: (req: FastifyRequest) => {
        return req.cookies?.[COOKIE_NAME] || null;
      },
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'change-me'),
    });
  }

  async validate(payload: JwtPayload) {
    return {
      userId: payload.sub,
      orgId: payload.org,
      role: payload.role,
    };
  }
}
