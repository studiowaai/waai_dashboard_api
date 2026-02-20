import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { PromptsController } from './prompts.controller';
import { PromptsService } from './prompts.service';

@Module({
  imports: [TypeOrmModule, HttpModule],
  controllers: [PromptsController],
  providers: [PromptsService],
})
export class PromptsModule {}
