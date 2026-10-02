import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { AppealService } from './appeal.service';
import { AdjudicateDto, CreateAppealDto } from './dto';

@Controller('appeals')
export class AppealController {
  constructor(private readonly appeals: AppealService) {}

  @UseGuards(AuthGuard('jwt'))
  @Post()
  create(@Req() req: any, @Body() dto: CreateAppealDto) {
    return this.appeals.createAppeal(req.user, dto);
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.appeals.listAppeals(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.appeals.getAppeal(id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post(':id/run-engine')
  run(@Param('id') id: string) {
    return this.appeals.runEngine(id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post(':id/adjudicate')
  adjudicate(@Req() req: any, @Param('id') id: string, @Body() dto: AdjudicateDto) {
    return this.appeals.adjudicate(req.user, id, dto);
  }
}
