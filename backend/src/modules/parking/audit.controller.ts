import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // 全链路追溯：按资源类型/ID 查询发布、预约、入场、异常、离场、分账日志
  @UseGuards(AuthGuard('jwt'))
  @Get()
  list(@Query('refType') refType?: string, @Query('refId') refId?: string) {
    return this.audit.list(refType, refId);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Get('all')
  listAll() {
    return this.audit.list();
  }
}
