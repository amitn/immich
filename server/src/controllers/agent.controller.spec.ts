import { UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { AgentMcpController } from 'src/controllers/agent-mcp.controller.js';
import { AgentController } from 'src/controllers/agent.controller.js';
import { Permission } from 'src/enum.js';
import { AgentService } from 'src/services/agent.service.js';
import { errorDto } from 'test/medium/responses.js';
import { factory } from 'test/small.factory.js';
import { ControllerContext, controllerSetup, mockBaseService } from 'test/utils.js';

describe(AgentController.name, () => {
  let ctx: ControllerContext;
  const service = mockBaseService(AgentService);

  beforeAll(async () => {
    ctx = await controllerSetup([AgentController, AgentMcpController], [{ provide: AgentService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
  });

  const expectPermission = (permission: Permission) =>
    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ permission }) }),
    );

  describe('POST /agent/sessions', () => {
    it('should create a session', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/agent/sessions').send({ title: 'Italy' });
      expect(status).toBe(201);
      expectPermission(Permission.AgentSessionCreate);
      expect(service.createSession).toHaveBeenCalledWith(undefined, { title: 'Italy' });
    });

    it('should accept a missing title', async () => {
      const { status } = await request(ctx.getHttpServer()).post('/agent/sessions').send({});
      expect(status).toBe(201);
    });
  });

  describe('GET /agent/sessions', () => {
    it('should require the read permission', async () => {
      await request(ctx.getHttpServer()).get('/agent/sessions');
      expectPermission(Permission.AgentSessionRead);
      expect(service.getSessions).toHaveBeenCalled();
    });
  });

  describe('GET /agent/sessions/:id', () => {
    it('should require a valid id', async () => {
      const { status, body } = await request(ctx.getHttpServer()).get('/agent/sessions/123');
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['id'], message: 'Invalid UUID' }]));
    });
  });

  describe('DELETE /agent/sessions/:id', () => {
    it('should delete the session', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).delete(`/agent/sessions/${id}`);
      expect(status).toBe(204);
      expectPermission(Permission.AgentSessionDelete);
      expect(service.deleteSession).toHaveBeenCalledWith(undefined, id);
    });
  });

  describe('POST /agent/sessions/:id/prompt', () => {
    it('should require text', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${factory.uuid()}/prompt`)
        .send({ text: '  ' });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['text'], message: expect.any(String) }]));
    });

    it('should require valid asset ids', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${factory.uuid()}/prompt`)
        .send({ text: 'hi', assetIds: ['invalid'] });
      expect(status).toBe(400);
      expect(body).toEqual(errorDto.validationError([{ path: ['assetIds', 0], message: 'Invalid UUID' }]));
    });

    it('should return no content', async () => {
      const id = factory.uuid();
      const assetIds = [factory.uuid()];
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${id}/prompt`)
        .send({ text: ' hi ', assetIds });
      expect(status).toBe(204);
      expectPermission(Permission.AgentSessionUpdate);
      expect(service.prompt).toHaveBeenCalledWith(undefined, id, { text: 'hi', assetIds });
    });
  });

  describe('POST /agent/sessions/:id/cancel', () => {
    it('should return no content', async () => {
      const id = factory.uuid();
      const { status } = await request(ctx.getHttpServer()).post(`/agent/sessions/${id}/cancel`);
      expect(status).toBe(204);
      expect(service.cancel).toHaveBeenCalledWith(undefined, id);
    });
  });

  describe('POST /agent/sessions/:id/permissions/:requestId', () => {
    it('should require a decision', async () => {
      const { status, body } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${factory.uuid()}/permissions/${factory.uuid()}`)
        .send({});
      expect(status).toBe(400);
      expect(body).toEqual(
        errorDto.validationError([{ path: [], message: 'Either optionId or approved is required' }]),
      );
    });

    it('should require a valid request id', async () => {
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${factory.uuid()}/permissions/abc`)
        .send({ approved: true });
      expect(status).toBe(400);
    });

    it('should pass the decision to the service', async () => {
      const id = factory.uuid();
      const requestId = factory.uuid();
      const { status } = await request(ctx.getHttpServer())
        .post(`/agent/sessions/${id}/permissions/${requestId}`)
        .send({ optionId: 'allow' });
      expect(status).toBe(204);
      expectPermission(Permission.AgentSessionUpdate);
      expect(service.respondToPermission).toHaveBeenCalledWith(undefined, id, requestId, { optionId: 'allow' });
    });
  });

  describe('ALL /agent/mcp', () => {
    it('should not use user authentication', async () => {
      service.handleMcpRequest.mockImplementation((_authorization, _req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
        return Promise.resolve();
      });

      const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
      const { status } = await request(ctx.getHttpServer())
        .post('/agent/mcp')
        .set('Authorization', 'Bearer agent-token')
        .send(body);

      expect(status).toBe(200);
      expect(ctx.authenticate).not.toHaveBeenCalled();
      expect(service.handleMcpRequest).toHaveBeenCalledWith(
        'Bearer agent-token',
        expect.anything(),
        expect.anything(),
        body,
      );
    });

    it('should return 401 for an invalid token', async () => {
      service.handleMcpRequest.mockRejectedValue(new UnauthorizedException('Invalid agent token'));
      const { status } = await request(ctx.getHttpServer()).post('/agent/mcp').send({});
      expect(status).toBe(401);
    });
  });
});
