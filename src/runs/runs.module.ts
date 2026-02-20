import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [TypeOrmModule],
  controllers: [RunsController],
  providers: [RunsService],
})
export class RunsModule {}
