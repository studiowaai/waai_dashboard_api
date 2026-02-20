import { Controller, Post, Body, Res, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  password: string;
}

const COOKIE_NAME = 'session';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto, @Res() reply: FastifyReply) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    const token = this.authService.createJwt(user.id.toString(), user.org_id.toString(), user.role);

    // Determine cookie domain based on CORS origins
    const corsOrigins = this.configService.get<string>('CORS_ORIGIN', 'http://localhost:8000');
    const hasLocalhost = corsOrigins.includes('localhost') || corsOrigins.includes('127.0.0.1');
    const cookieDomain = hasLocalhost ? undefined : '.apps.studiowaai.nl';

    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      domain: cookieDomain,
      path: '/',
    });

    reply.send({ ok: true });
  }

  @Post('logout')
  async logout(@Res() reply: FastifyReply) {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    reply.send({ ok: true });
  }
}
