import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceRolesGuard } from './workspace-roles.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule, AuthModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceRolesGuard],
  exports: [WorkspacesService, WorkspaceRolesGuard],
})
export class WorkspacesModule {}
