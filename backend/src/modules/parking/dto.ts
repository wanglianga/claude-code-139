import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PublishSpotDto {
  @IsString() @Length(1, 32) code: string;
  @IsString() @Length(1, 64) zone: string;
  @IsString() @Length(1, 64) deedNo: string;
  @IsString() communityId: string;
  @IsBoolean() nearCharger: boolean;
  @IsBoolean() isChargerSpot: boolean;
  @IsBoolean() allowVisitor: boolean;
  @IsString() monthlyPriority: 'none' | 'monthly_first';
  @IsString() @IsOptional() navigationHint?: string;
  @IsInt() @Min(0) @Max(100) @IsOptional() hourlyRateOverride?: number;
}

export class CreateSlotDto {
  @IsString() spotId: string;
  @IsString() date: string; // YYYY-MM-DD
  @IsInt() @Min(0) @Max(1440) startMinute: number;
  @IsInt() @Min(1) @Max(2880) endMinute: number; // 可跨午夜
  @IsBoolean() @IsOptional() guaranteed?: boolean;
}

export class ReviewSpotDto {
  @IsBoolean() approve: boolean;
  @IsString() @IsOptional() note?: string;
}

export class CreateReservationDto {
  @IsString() slotId: string;
  @IsString() @Length(1, 16) plate: string;
  @IsISO8601() startTime: string;
  @IsISO8601() endTime: string;
  @IsBoolean() @IsOptional() isVisitor?: boolean;
  @IsString() @IsOptional() vehicleType?: 'ev' | 'fuel';
  @IsString() @IsOptional() couponCode?: string;
}

export class GateEntryDto {
  @IsString() @IsOptional() reservationId?: string;
  @IsString() @IsOptional() recognizedPlate?: string; // 摄像头识别（失败时为空/脏号）
  @IsOptional() @Min(0) @Max(1) @Type(() => Number)
  confidence?: number;
  @IsBoolean() @IsOptional() manual?: boolean; // 物业人工放行
  @IsString() @IsOptional() verifiedPlate?: string; // 人工核验后的车牌
  @IsString() @IsOptional() note?: string;
  @IsISO8601() @IsOptional() at?: string;
}

export class GateExitDto {
  @IsString() @IsOptional() reservationId?: string;
  @IsString() @IsOptional() recognizedPlate?: string;
  @IsOptional() @Min(0) @Max(1) @Type(() => Number)
  confidence?: number;
  @IsBoolean() @IsOptional() manual?: boolean;
  @IsString() @IsOptional() verifiedPlate?: string;
  @IsString() @IsOptional() couponCode?: string;
  @IsString() @IsOptional() note?: string;
  @IsISO8601() @IsOptional() at?: string;
}

export class OwnerReturnDto {
  @IsString() slotId: string;
  @IsISO8601() @IsOptional() at?: string;
}

export class ReportIncidentDto {
  @IsString() type:
    | 'visitor_overtime'
    | 'stranger_occupation'
    | 'recognition_failed'
    | 'weak_signal'
    | 'fuel_on_charger'
    | 'manual_release';
  @IsString() spotId: string;
  @IsString() @IsOptional() reservationId?: string;
  @IsString() @IsOptional() involvedPlate?: string;
  @IsString() description: string;
  @IsISO8601() @IsOptional() at?: string;
}

export class MoveNoticeDto {
  @IsString() plate: string;
  @IsString() @IsOptional() channel?: string;
  @IsISO8601() @IsOptional() at?: string;
}

export class NoticeAckDto {
  @IsBoolean() moved: boolean;
}

export class ResolveIncidentDto {
  @IsString() @IsOptional() note?: string;
}

export class PatrolDto {
  @IsString() spotId: string;
  @IsString() @IsOptional() plate?: string;
  @IsString() @IsOptional() note?: string;
  @IsISO8601() @IsOptional() at?: string;
}

export class EvidenceDto {
  @IsString() kind:
    | 'anpr'
    | 'site_photo'
    | 'nav_screen'
    | 'gate_log'
    | 'owner_return'
    | 'patrol'
    | 'reservation'
    | 'other';
  @IsString() content: string;
  @IsISO8601() @IsOptional() occurredAt?: string;
  @IsBoolean() @IsOptional() favorsAppellant?: boolean;
  @IsString() @IsOptional() spotCode?: string;
  @IsString() @IsOptional() plate?: string;
}

export class CreateAppealDto {
  @IsString() @IsOptional() reservationId?: string;
  @IsString() @IsOptional() spotId?: string;
  @IsString() @Length(1, 16) plate: string;
  @IsString() reason: string;
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  @IsOptional()
  evidences?: EvidenceDto[];
}

export class AdjudicateDto {
  // 可附加补充证据
  @ValidateNested({ each: true })
  @Type(() => EvidenceDto)
  @IsOptional()
  evidences?: EvidenceDto[];
  // 物业可人工复核改判（留痕）
  @IsString() @IsOptional() overrideResponsibility?:
    | 'driver'
    | 'owner'
    | 'platform_navigation'
    | 'property'
    | 'stranger'
    | 'none';
  @IsOptional() @Min(0) @Max(1) @Type(() => Number)
  overrideDriverShare?: number;
  @IsString() @IsOptional() note?: string;
}

export class DispatchDto {
  @IsString() reservationId: string;
  @IsString() @IsOptional() targetSlotId?: string; // 指定改派目标时段
  @IsString() @IsOptional() note?: string;
  @IsISO8601() @IsOptional() at?: string;
}
