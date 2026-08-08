import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createHash, randomBytes } from "node:crypto";
import { ApiKey } from "./entities/api-key.entity";
import { CreateApiServiceDto } from "./dto/create-api-service.dto";
import type { ApiKeyClaim } from "../../common/decorators/current-api-key.decorator";

export interface ApiServiceListItem {
  id: string;
  serviceName: string;
  description: string;
  keyPrefix: string;
  kbId: string;
  callCount: number;
  updatedAt: string;
}

export interface CreateResult {
  id: string;
  serviceName: string;
  apiKey: string; // 明文仅返回一次
  endpoint: string;
}

@Injectable()
export class ApiKeyService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly repo: Repository<ApiKey>,
  ) {}

  private genKey(prefix: string): string {
    const raw = randomBytes(24).toString("base64url").replace(/=/g, "").slice(0, 32);
    return `${prefix}${raw}`;
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  async create(dto: CreateApiServiceDto): Promise<CreateResult> {
    const plain = this.genKey(process.env.API_KEY_PREFIX ?? "ek_");
    const apiKey = this.repo.create({
      serviceName: dto.serviceName,
      description: dto.description,
      kbId: dto.kbId,
      creator: dto.creator,
      keyHash: this.hashKey(plain),
      keyPrefix: plain.slice(0, 12),
      isActive: true,
    });
    const saved = await this.repo.save(apiKey);
    return {
      id: saved.id,
      serviceName: saved.serviceName,
      apiKey: plain,
      endpoint: `/api/service-calls/${saved.id}/chat/stream`,
    };
  }

  async findAll(): Promise<ApiServiceListItem[]> {
    const list = await this.repo.find({ order: { createdAt: "DESC" } });
    return list.map((k) => ({
      id: k.id,
      serviceName: k.serviceName,
      description: k.description ?? "",
      keyPrefix: k.keyPrefix,
      kbId: k.kbId,
      callCount: Number(k.callCount ?? 0),
      updatedAt: this.fmt(k.updatedAt),
    }));
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const k = await this.repo.findOne({ where: { id } });
    if (!k) throw new NotFoundException(`服务不存在: ${id}`);
    await this.repo.remove(k);
    return { success: true };
  }

  /** 校验 API Key，返回声明（含 kbId）或 null */
  async validateKey(plain: string): Promise<ApiKeyClaim | null> {
    const hash = this.hashKey(plain);
    const k = await this.repo.findOne({ where: { keyHash: hash, isActive: true } });
    if (!k) return null;
    if (k.expiresAt && k.expiresAt.getTime() < Date.now()) return null;
    return { id: k.id, serviceName: k.serviceName, kbId: k.kbId };
  }

  /** 校验通过后记入调用统计 */
  async recordCall(id: string): Promise<void> {
    await this.repo.increment({ id }, "callCount", 1);
    await this.repo.update({ id }, { lastCalledAt: new Date() });
  }

  private fmt(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
