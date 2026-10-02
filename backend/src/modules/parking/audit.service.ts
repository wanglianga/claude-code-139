import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditActorKind } from '../../entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
  ) {}

  async record(
    actorKind: AuditActorKind,
    actorId: string | null,
    action: string,
    refType: string,
    refId: string | null,
    payload?: Record<string, any>,
  ) {
    const log = this.logs.create({
      actorKind,
      actorId,
      action,
      refType,
      refId,
      payload: payload ?? null,
    });
    return this.logs.save(log);
  }

  list(refType?: string, refId?: string) {
    const where: any = {};
    if (refType) where.refType = refType;
    if (refId) where.refId = refId;
    return this.logs.find({ where, order: { at: 'ASC' } });
  }
}
