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
import { ParkingService } from './parking.service';
import {
  CreateReservationDto,
  CreateSlotDto,
  DispatchDto,
  GateEntryDto,
  GateExitDto,
  MoveNoticeDto,
  NoticeAckDto,
  OwnerReturnDto,
  PatrolDto,
  PublishSpotDto,
  ReportIncidentDto,
  ResolveIncidentDto,
  ReviewSpotDto,
} from './dto';

@Controller('parking')
export class ParkingController {
  constructor(private readonly parking: ParkingService) {}

  // ---- 公开查询 ----
  @Get('communities')
  communities() {
    return this.parking.listCommunities();
  }

  @Get('spots')
  spots(@Query('communityId') communityId?: string) {
    return this.parking.listBookableSpots(communityId);
  }

  // ---- 业主 ----
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('owner', 'admin')
  @Get('my-spots')
  mySpots(@Req() req: any) {
    return this.parking.mySpots(req.user.id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('owner', 'admin')
  @Post('spots')
  publish(@Req() req: any, @Body() dto: PublishSpotDto) {
    return this.parking.publishSpot(req.user, dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('owner', 'admin')
  @Post('slots')
  createSlot(@Req() req: any, @Body() dto: CreateSlotDto) {
    return this.parking.createSlot(req.user, dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('owner', 'property', 'admin')
  @Post('owner-return')
  ownerReturn(@Req() req: any, @Body() dto: OwnerReturnDto) {
    return this.parking.ownerReturn(req.user, dto);
  }

  // ---- 物业审核 ----
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Get('review/pending')
  pending() {
    return this.parking.listPendingSpots();
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post('spots/:id/review')
  review(@Req() req: any, @Param('id') id: string, @Body() dto: ReviewSpotDto) {
    return this.parking.reviewSpot(req.user, id, dto);
  }

  // ---- 车主预约 ----
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('driver', 'admin')
  @Post('reservations')
  reserve(@Req() req: any, @Body() dto: CreateReservationDto) {
    return this.parking.createReservation(req.user, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('reservations/:id/cancel')
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.parking.cancelReservation(req.user, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('reservations')
  reservations(@Req() req: any, @Query('scope') scope = 'all') {
    return this.parking.listReservations(req.user, scope);
  }

  @Get('reservations/:id')
  reservation(@Param('id') id: string) {
    return this.parking.getReservation(id);
  }

  // ---- 道闸（物业/系统模拟）----
  @UseGuards(AuthGuard('jwt'))
  @Post('gate/entry')
  gateEntry(@Req() req: any, @Body() dto: GateEntryDto) {
    return this.parking.gateEntry(req.user, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('gate/exit')
  gateExit(@Req() req: any, @Body() dto: GateExitDto) {
    return this.parking.gateExit(req.user, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('gate/events')
  gateEvents(@Query('spotId') spotId?: string) {
    return this.parking.listGateEvents(spotId);
  }

  // ---- 夜间异常 ----
  @UseGuards(AuthGuard('jwt'))
  @Post('incidents')
  report(@Req() req: any, @Body() dto: ReportIncidentDto) {
    return this.parking.reportIncident(req.user, dto);
  }

  @Get('incidents')
  incidents(@Query('status') status?: string, @Query('type') type?: string) {
    return this.parking.listIncidents(status, type);
  }

  @Get('incidents/:id')
  incident(@Param('id') id: string) {
    return this.parking.getIncident(id);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post('incidents/:id/move-notice')
  moveNotice(@Req() req: any, @Param('id') id: string, @Body() dto: MoveNoticeDto) {
    return this.parking.sendMoveNotice(req.user, id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('move-notices/:id/ack')
  ackNotice(@Req() req: any, @Param('id') id: string, @Body() dto: NoticeAckDto) {
    return this.parking.ackMoveNotice(req.user, id, dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post('incidents/:id/resolve')
  resolve(@Req() req: any, @Param('id') id: string, @Body() dto: ResolveIncidentDto) {
    return this.parking.resolveIncident(req.user, id, dto);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post('incidents/:id/charge-stranger')
  chargeStranger(@Req() req: any, @Param('id') id: string, @Body() body: { at?: string }) {
    return this.parking.chargeStranger(req.user, id, body);
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post('dispatch')
  dispatch(@Req() req: any, @Body() dto: DispatchDto) {
    return this.parking.dispatch(req.user, dto);
  }

  // ---- 巡查 ----
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('property', 'admin')
  @Post('patrol')
  patrol(@Req() req: any, @Body() dto: PatrolDto) {
    return this.parking.patrol(req.user, dto);
  }

  @Get('patrol')
  listPatrols() {
    return this.parking.listPatrols();
  }

  // ---- 优惠券 ----
  @UseGuards(AuthGuard('jwt'))
  @Get('coupons')
  coupons(@Req() req: any) {
    return this.parking.listCoupons(req.user);
  }
}
