import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, Roles } from '../auth/auth.guard';
import { JwtUser } from '../auth/auth.service';
import { DbService } from '../database/db.service';
import { adjudicateAppeal, AdjudicationResult, EvidenceItem } from '../domain/adjudication';

class AddEvidenceDto {
  source: 'plate_recognition' | 'reservation' | 'photo' | 'gate_log' | 'owner_home' | 'patrol' | 'appeal_statement' | 'signal';
  title: string;
  content: string;
  media_url?: string;
  captured_at?: string;
  stance?: 'support' | 'refute' | 'neutral';
  confidence?: number;
}

class CreateAppealDto {
  reservation_id: number;
  reason: string;
  evidence?: AddEvidenceDto[];
}

@Controller('appeals')
@UseGuards(AuthGuard)
export class AppealsController {
  constructor(private db: DbService) {}

  // 车主发起错停申诉
  @Roles('driver')
  @Post()
  async create(@CurrentUser() user: JwtUser, @Body() dto: CreateAppealDto) {
    return this.db.withTx(async (c) => {
      const r = await c.query(
        `SELECT r.*, s.code AS spot_code, s.owner_id FROM reservations r
         JOIN parking_spots s ON s.id=r.spot_id WHERE r.id=$1 AND r.driver_id=$2 FOR UPDATE`,
        [dto.reservation_id, user.sub],
      );
      const reservation = r.rows[0];
      if (!reservation) throw new BadRequestException('预约不存在或不属于本人');

      const ins = await c.query(
        `INSERT INTO appeals(code, reservation_id, spot_id, appellant_id, reason, status)
         VALUES ($1,$2,$3,$4,$5,'open') RETURNING *`,
        ['A' + Date.now().toString(36).toUpperCase(), dto.reservation_id, reservation.spot_id, user.sub, dto.reason],
      );
      const appeal = ins.rows[0];

      // 车主陈述 + 自行上传的证据
      await c.query(
        `INSERT INTO appeal_evidence(appeal_id, source, title, content, captured_at, uploaded_by)
         VALUES ($1,'appeal_statement',$2,$3, now(), $4)`,
        [appeal.id, '车主申诉陈述', dto.reason, user.sub],
      );
      for (const e of dto.evidence ?? []) {
        await c.query(
          `INSERT INTO appeal_evidence(appeal_id, source, title, content, media_url, captured_at, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            appeal.id,
            e.source,
            e.title,
            e.content,
            e.media_url ?? null,
            e.captured_at ? new Date(e.captured_at) : new Date(),
            user.sub,
          ],
        );
      }

      const result = await this.runAdjudication(c, appeal.id);
      await c.query(
        `INSERT INTO service_events(reservation_id, spot_id, type, actor_id, actor_role, detail)
         VALUES ($1,$2,'appeal_submitted',$3,'driver',$4)`,
        [
          dto.reservation_id,
          reservation.spot_id,
          user.sub,
          JSON.stringify({ appeal_id: appeal.id, auto: result.ruling, confidence: result.confidence }),
        ],
      );
      return { appeal, adjudication: result };
    });
  }

  @Get()
  async list(@CurrentUser() user: JwtUser) {
    let where = '1=1';
    const params: any[] = [];
    if (user.role === 'driver') {
      params.push(user.sub);
      where = `a.appellant_id=$${params.length}`;
    } else if (user.role === 'owner') {
      params.push(user.sub);
      where = `s.owner_id=$${params.length}`;
    }
    return this.db
      .query(
        `SELECT a.*, r.code AS reservation_code, r.plate, s.code AS spot_code,
                u.name AS appellant_name
         FROM appeals a
         JOIN reservations r ON r.id=a.reservation_id
         JOIN parking_spots s ON s.id=a.spot_id
         JOIN users u ON u.id=a.appellant_id
         WHERE ${where}
         ORDER BY a.created_at DESC LIMIT 200`,
        params,
      )
      .then((q) => q.rows);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const appeal = await this.db.query(
      `SELECT a.*, r.code AS reservation_code, r.plate, r.start_at AS reserved_start, r.end_at AS reserved_end,
              s.code AS spot_code, u.name AS appellant_name
       FROM appeals a
       JOIN reservations r ON r.id=a.reservation_id
       JOIN parking_spots s ON s.id=a.spot_id
       JOIN users u ON u.id=a.appellant_id
       WHERE a.id=$1`,
      [id],
    );
    if (!appeal.rows[0]) throw new BadRequestException('申诉不存在');
    const evidence = await this.db.query(
      `SELECT * FROM appeal_evidence WHERE appeal_id=$1 ORDER BY captured_at NULLS LAST, id`,
      [id],
    );
    const adjudication = await this.buildAdjudication(this.db, appeal.rows[0]);
    return { ...appeal.rows[0], evidence: evidence.rows, adjudication };
  }

  // 追加证据（物业巡查照片、业主上传回家凭证等）
  @Post(':id/evidence')
  async addEvidence(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: AddEvidenceDto) {
    const a = await this.db.query(`SELECT * FROM appeals WHERE id=$1`, [id]);
    if (!a.rows[0]) throw new BadRequestException('申诉不存在');
    await this.db.query(
      `INSERT INTO appeal_evidence(appeal_id, source, title, content, media_url, captured_at, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        id,
        dto.source,
        dto.title,
        dto.content,
        dto.media_url ?? null,
        dto.captured_at ? new Date(dto.captured_at) : new Date(),
        user.sub,
      ],
    );
    const result = await this.buildAdjudication(this.db, a.rows[0]);
    return { adjudication: result };
  }

  // 物业/管理员终裁（可采纳自动建议或人工改判）
  @Roles('property', 'admin')
  @Post(':id/rule')
  async rule(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() body: { ruling: AdjudicationResult['ruling']; note?: string },
  ) {
    const allowed = ['driver_fault', 'owner_fault', 'platform_fault', 'property_fault', 'stranger', 'mixed', 'no_fault'];
    if (!allowed.includes(body.ruling)) throw new BadRequestException('裁决类型非法');
    return this.db.withTx(async (c) => {
      const a = await c.query(`SELECT * FROM appeals WHERE id=$1 FOR UPDATE`, [id]);
      if (!a.rows[0]) throw new BadRequestException('申诉不存在');
      await c.query(
        `UPDATE appeals SET status='closed', ruling=$1, ruling_note=$2, ruled_by=$3, ruled_at=now() WHERE id=$4`,
        [body.ruling, body.note ?? null, user.sub, id],
      );
      await c.query(
        `INSERT INTO service_events(reservation_id, spot_id, type, actor_id, actor_role, detail)
         VALUES ($1,$2,'appeal_ruled',$3,$4,$5)`,
        [
          a.rows[0].reservation_id,
          a.rows[0].spot_id,
          user.sub,
          user.role,
          JSON.stringify({ ruling: body.ruling, note: body.note }),
        ],
      );
      return { ok: true };
    });
  }

  /** 汇总六类证据并执行自动裁决；系统证据（识别/道闸/巡查/业主回家）自动从事件流抽取 */
  async runAdjudication(client: any, appealId: number): Promise<AdjudicationResult> {
    const appealQ = await client.query(
      `SELECT a.*, r.plate AS reserved_plate, r.start_at, r.end_at, s.code AS spot_code
       FROM appeals a
       JOIN reservations r ON r.id=a.reservation_id
       JOIN parking_spots s ON s.id=a.spot_id
       WHERE a.id=$1`,
      [appealId],
    );
    const appeal = appealQ.rows[0];
    const result = await this.buildAdjudication(client, appeal);
    if (appeal.status === 'open') {
      await client.query(`UPDATE appeals SET status='investigating' WHERE id=$1`, [appealId]);
    }
    return result;
  }

  private async buildAdjudication(client: any, appeal: any): Promise<AdjudicationResult> {
    const reservationId = appeal.reservation_id;
    const stored = await client.query(
      `SELECT source, title, content, media_url, captured_at FROM appeal_evidence
       WHERE appeal_id=$1 ORDER BY captured_at NULLS LAST, id`,
      [appeal.id],
    );

    const evidence: EvidenceItem[] = stored.rows.map((e: any) => ({
      source: e.source,
      title: e.title,
      content: [e.title, e.content].filter(Boolean).join('：'),
      capturedAt: e.captured_at,
      stance: /支持|无责|陌生|识别失败|人工放行|信号|回家/.test(`${e.title}${e.content}`) ? 'support' : 'neutral',
    }));

    // ---- 自动从同一笔停车服务的事件流抽取系统证据 ----
    const events = await client.query(
      `SELECT type, occurred_at, plate, gate, confidence, detail FROM service_events
       WHERE reservation_id=$1 ORDER BY occurred_at, id`,
      [reservationId],
    );
    const seen = new Set(evidence.map((e) => e.content));
    const push = (e: EvidenceItem) => {
      if (!seen.has(e.content)) evidence.push(e);
    };

    // 预约记录本身（中性：只证明预约存在，不指向责任）
    push({
      source: 'reservation',
      title: '预约记录',
      content: `预约车位 ${appeal.spot_code ?? appeal.spot_code}，车牌 ${appeal.reserved_plate ?? appeal.plate}，预约时段内有效`,
      capturedAt: appeal.start_at,
      stance: 'neutral',
    });

    let actualPlate: string | null = null;
    const incidents: AdjudicationInput2 = [];

    for (const ev of events.rows) {
      const d = ev.detail ?? {};
      switch (ev.type) {
        case 'gate_entry':
        case 'manual_release':
          push({
            source: 'gate_log',
            title: '道闸入场日志',
            content: `${ev.occurred_at.toISOString?.() ?? ev.occurred_at} ${ev.gate ?? ''} 道闸${ev.type === 'manual_release' ? '物业人工放行' : '识别放行'}，车牌 ${ev.plate}`,
            capturedAt: ev.occurred_at,
            stance: 'neutral',
            confidence: Number(ev.confidence ?? 0.9),
          });
          actualPlate = ev.plate;
          break;
        case 'recognition_fail':
          push({
            source: 'gate_log',
            title: '道闸识别失败记录',
            content: `道闸识别失败：${d.hint ?? '无匹配/低置信度'}，置信度 ${ev.confidence}`,
            capturedAt: ev.occurred_at,
            stance: 'support',
          });
          break;
        case 'wrong_parking_detected':
          push({
            source: 'plate_recognition',
            title: '停放核验',
            content: `预约车位 ${d.expected}，实际停放车位 ${d.actual}；识别车牌 ${ev.plate} 停在车位 ${d.actual}`,
            actualSpot: d.actual,
            expectedSpot: d.expected,
            capturedAt: ev.occurred_at,
            stance: 'refute',
            confidence: 0.9,
          });
          actualPlate = ev.plate;
          break;
        case 'parking_confirmed':
          push({
            source: 'plate_recognition',
            title: '车牌识别停放确认',
            content: `车牌 ${ev.plate} 正常停在预约车位 ${appeal.spot_code ?? ''}`,
            capturedAt: ev.occurred_at,
            stance: 'support',
            confidence: 0.9,
          });
          actualPlate = ev.plate;
          break;
        case 'owner_return_report':
          push({
            source: 'owner_home',
            title: '业主回家时间',
            content: `业主在共享时段内临时回家（${d.eta_minutes ?? 30} 分钟后到达）`,
            capturedAt: ev.occurred_at,
            stance: 'support',
          });
          incidents.push({ type: 'owner_return', started_at: ev.occurred_at });
          break;
        case 'weak_signal_report':
          push({
            source: 'signal',
            title: '地下车库信号差上报',
            content: `区域 ${d.area ?? 'B2'} 信号差，使用离线导航`,
            capturedAt: ev.occurred_at,
            stance: 'support',
          });
          incidents.push({ type: 'weak_signal' });
          break;
      }
    }

    // 巡查记录
    const patrols = await client.query(
      `SELECT p.note, p.plate, p.media_url, p.patrolled_at FROM patrol_logs p
       WHERE p.spot_id=$1 AND p.patrolled_at BETWEEN $2 AND $3
       ORDER BY p.patrolled_at`,
      [appeal.spot_id, appeal.start_at, appeal.end_at],
    );
    for (const p of patrols.rows) {
      push({
        source: 'patrol',
        title: '物业巡查记录',
        content: p.note + (p.media_url ? `（现场照片 ${p.media_url}）` : ''),
        capturedAt: p.patrolled_at,
        stance: /normal/.test(p.note) ? 'support' : 'neutral',
      });
      if (/stranger/.test(p.note)) actualPlate = p.plate ?? actualPlate;
    }

    return adjudicateAppeal({
      reservedSpotCode: appeal.spot_code,
      reservedPlate: appeal.reserved_plate ?? appeal.plate,
      actualPlate,
      evidence,
      incidents,
      reservationStart: appeal.start_at,
      reservationEnd: appeal.end_at,
    });
  }
}

type AdjudicationInput2 = Array<{ type: string; started_at?: Date | null; resolved_at?: Date | null }>;
