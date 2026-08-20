import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { KnowledgeBaseService } from '../../src/modules/knowledge-base/knowledge-base.service';
import { KnowledgeBaseController } from '../../src/modules/knowledge-base/knowledge-base.controller';

let app: INestApplication;
let kbRepo: any;

function makeMockRepo(findOneResult: any = null) {
  return {
    findOne: vi.fn().mockResolvedValue(findOneResult),
    save: vi.fn().mockImplementation(async (entity: any) => ({
      ...entity,
      id: entity.id ?? `id-${Date.now()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    create: vi.fn((entity: any) => entity),
    count: vi.fn().mockResolvedValue(0),
    remove: vi.fn().mockResolvedValue(undefined),
    createQueryBuilder: vi.fn(() => ({
      where: vi.fn().mockReturnThis(),
      addWhere: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi.fn().mockResolvedValue([]),
      getOne: vi.fn().mockResolvedValue(findOneResult),
    })),
  };
}

describe('KnowledgeBase API (integration — NestJS TestingModule)', () => {
  beforeAll(async () => {
    kbRepo = makeMockRepo();
    const docRepo = makeMockRepo();
    const chunkRepo = makeMockRepo();

    const kbService = Object.assign(Object.create(KnowledgeBaseService.prototype), {
      kbRepo,
      docRepo,
      chunkRepo,
    });

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KnowledgeBaseController],
      providers: [{ provide: KnowledgeBaseService, useValue: kbService }],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    kbRepo.findOne.mockReset();
    kbRepo.save.mockReset();
  });

  function api() {
    return request(app.getHttpServer());
  }

  it('POST /api/knowledge-bases — 创建成功', async () => {
    kbRepo.findOne.mockResolvedValue(null);
    kbRepo.save.mockResolvedValue({ id: 'new-1', name: 'Test KB', description: 'desc' });

    const res = await api()
      .post('/api/knowledge-bases')
      .send({ name: 'Test KB', description: 'desc' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(0);
    expect(res.body.data.name).toBe('Test KB');
  });

  it('POST /api/knowledge-bases — 重复名称返回 409', async () => {
    kbRepo.findOne.mockResolvedValue({ id: 'existing', name: 'Test KB' });

    const res = await api()
      .post('/api/knowledge-bases')
      .send({ name: 'Test KB', description: 'desc' });
    expect(res.status).toBe(409);
  });

  it('GET /api/knowledge-bases — 返回列表', async () => {
    kbRepo.createQueryBuilder.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      getMany: vi
        .fn()
        .mockResolvedValue([
          { id: '1', name: 'KB A', createdAt: new Date(), type: 'free', description: null },
        ]),
    });

    const res = await api().get('/api/knowledge-bases');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('GET /api/knowledge-bases/:id — 不存在返回 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);

    const res = await api().get('/api/knowledge-bases/nonexistent');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/knowledge-bases/:id — 删除成功', async () => {
    kbRepo.findOne.mockResolvedValue({ id: '1', name: 'KB A' });

    const res = await api().delete('/api/knowledge-bases/1');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
  });

  it('DELETE /api/knowledge-bases/:id — 不存在的 ID 返回 404', async () => {
    kbRepo.findOne.mockResolvedValue(null);

    const res = await api().delete('/api/knowledge-bases/nonexistent');
    expect(res.status).toBe(404);
  });
});
