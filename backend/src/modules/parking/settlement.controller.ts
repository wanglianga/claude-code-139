import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { SettlementService } from './settlement.service';

@Controller('settlements')
export class SettlementController {
  constructor(private readonly svc: SettlementService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.svc.getSettlement(id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post('run')
  run(
    @Req() req: any,
    @Body() body: { communityId: string; date: string },
  ) {
    return this.svc.runSettlement(req.user, body.communityId, body.date);
  }
}

@Controller('trace')
export class TraceController {
  constructor(private readonly svc: SettlementService) {}

  // 同一车位的占用时间线解释（谁使用/谁支付/谁违约）
  @Get('spots/:id/timeline')
  timeline(@Param('id') id: string, @Query('date') date?: string) {
    return this.svc.spotTimeline(id, date);
  }
}
