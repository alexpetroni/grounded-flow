import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EventsService } from './events.service';

const mockRepo = {
  create: vi.fn(),
  findById: vi.fn(),
  updateStatus: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
};

const mockQueue = {
  add: vi.fn().mockResolvedValue({ id: 'job-1' }),
};

const mockConfig = {
  get: (key: string) =>
    key === 'BULLMQ_ATTEMPTS' ? 3 : key === 'BULLMQ_BACKOFF_MS' ? 1000 : undefined,
};

function makeService() {
  return new EventsService(mockRepo as never, mockQueue as never, mockConfig as never);
}

describe('EventsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('regression: POST /events rejects malformed body (no crash)', () => {
    it('throws BadRequestException when workflowType is missing', async () => {
      const service = makeService();
      await expect(service.create({ data: {} })).rejects.toBeInstanceOf(BadRequestException);
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for completely empty body', async () => {
      const service = makeService();
      await expect(service.create({})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException for null body', async () => {
      const service = makeService();
      await expect(service.create(null)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequestException for a non-object body', async () => {
      const service = makeService();
      await expect(service.create('bad')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('create', () => {
    it('persists event and enqueues job', async () => {
      mockRepo.create.mockResolvedValue({ id: 'evt-1' });
      const service = makeService();

      const result = await service.create({ workflowType: 'echo', data: { message: 'hi' } });

      expect(result).toEqual({ eventId: 'evt-1', status: 'pending' });
      expect(mockRepo.create).toHaveBeenCalledWith({
        workflowType: 'echo',
        data: { message: 'hi' },
      });
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process',
        { eventId: 'evt-1' },
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });

  describe('findById', () => {
    it('returns event data when found', async () => {
      const now = new Date();
      mockRepo.findById.mockResolvedValue({
        id: 'evt-1',
        status: 'completed',
        result: { foo: 'bar' },
        error: null,
        createdAt: now,
        updatedAt: now,
      });
      const service = makeService();
      const res = await service.findById('evt-1');
      expect(res.status).toBe('completed');
      expect(res.result).toEqual({ foo: 'bar' });
    });

    it('throws NotFoundException when event not found', async () => {
      mockRepo.findById.mockResolvedValue(null);
      const service = makeService();
      const { NotFoundException } = await import('@nestjs/common');
      await expect(service.findById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
