import { beforeEach, describe, expect, it, vi } from 'vitest';

const added: Array<{ name: string; data: unknown; opts: { jobId?: string } }> = [];

// vi.hoisted is required (not just vi.mock's own hoisting) because
// queues.ts constructs the Queue instances at module load time. That
// construction happens while this file's top-level consts are still being
// initialized, so a plain top-level `const` referenced from inside the
// mock factory below would throw a temporal-dead-zone ReferenceError.
const { getJob, removeExisting } = vi.hoisted(() => ({
  getJob: vi.fn(),
  removeExisting: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class {
    add = (name: string, data: unknown, opts: { jobId?: string }): Promise<void> => {
      added.push({ name, data, opts });
      return Promise.resolve();
    };
    getJob = getJob;
    close = (): Promise<void> => Promise.resolve();
  },
}));

import { enqueueEmbeddings } from './queues.js';

describe('enqueueEmbeddings', () => {
  beforeEach(() => {
    added.length = 0;
    getJob.mockReset();
    removeExisting.mockReset();
  });

  it('uses a deterministic job id (no timestamp suffix)', async () => {
    getJob.mockResolvedValue(null);
    await enqueueEmbeddings({ organizationId: 'org1', docId: 'doc1' });
    expect(added[0]?.opts.jobId).toBe('embed-doc1');
  });

  it('removes a finished job with the same id before re-adding', async () => {
    getJob.mockResolvedValue({
      isCompleted: () => Promise.resolve(true),
      isFailed: () => Promise.resolve(false),
      remove: removeExisting,
    });
    await enqueueEmbeddings({ organizationId: 'org1', docId: 'doc1' });
    expect(removeExisting).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(1);
  });

  it('leaves a pending job in place (dedupe) and still calls add, which BullMQ ignores', async () => {
    getJob.mockResolvedValue({
      isCompleted: () => Promise.resolve(false),
      isFailed: () => Promise.resolve(false),
      remove: removeExisting,
    });
    await enqueueEmbeddings({ organizationId: 'org1', docId: 'doc1' });
    expect(removeExisting).not.toHaveBeenCalled();
  });
});
