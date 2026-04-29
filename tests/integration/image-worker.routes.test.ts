/**
 * Integration tests for the image worker HTTP boundary.
 *
 * Boots the worker Express app via supertest (no real port), exercises the
 * /process/avatar wire format and the /health probe, and verifies the
 * concurrency semaphore returns 503 when the in-flight cap is exhausted.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import { createImageWorkerApp } from '../../src/imageWorker';
import { processAvatar } from '../../src/lib/imageProcessing';

async function makeJpeg(width = 50, height = 50): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 80, g: 120, b: 160 } },
  })
    .jpeg()
    .toBuffer();
}

describe('GET /health', () => {
  it('returns 200 with status:ok', async () => {
    const app = createImageWorkerApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('POST /process/avatar', () => {
  it('returns processed thumb + display + dimensions for a valid JPEG', async () => {
    const app = createImageWorkerApp();
    const jpeg = await makeJpeg(120, 90);

    const res = await request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(jpeg);

    expect(res.status).toBe(200);
    expect(res.body.widthPx).toBe(120);
    expect(res.body.heightPx).toBe(90);
    expect(typeof res.body.thumb).toBe('string');
    expect(typeof res.body.display).toBe('string');

    const thumb = Buffer.from(res.body.thumb, 'base64');
    const display = Buffer.from(res.body.display, 'base64');
    const thumbMeta = await sharp(thumb).metadata();
    const displayMeta = await sharp(display).metadata();
    expect(thumbMeta.format).toBe('jpeg');
    expect(thumbMeta.width).toBe(300);
    expect(thumbMeta.height).toBe(300);
    expect(displayMeta.format).toBe('jpeg');
  });

  it('rejects non-image body with 400', async () => {
    const app = createImageWorkerApp();
    const res = await request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('this is not an image'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unrecognized image type/);
  });

  it('rejects empty body with 400', async () => {
    const app = createImageWorkerApp();
    const res = await request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  it('returns 413 for payload over 5 MB', async () => {
    const app = createImageWorkerApp();
    const oversized = Buffer.alloc(6 * 1024 * 1024, 0xff);
    const res = await request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(oversized);
    expect(res.status).toBe(413);
  });

  it('returns 503 when concurrency cap is exhausted', async () => {
    let firstAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      firstAcquired = resolve;
    });
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const app = createImageWorkerApp({
      maxConcurrent: 1,
      semaphoreWaitMs: 200,
      processAvatarImpl: async (data) => {
        firstAcquired();
        await blocker;
        return processAvatar(data);
      },
    });

    const jpeg = await makeJpeg();
    // Fire first request; .then() triggers supertest's .end(). Don't await yet.
    const firstP = request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(jpeg)
      .then((r) => r);

    // Wait until the first request has acquired the semaphore slot.
    await acquired;

    const secondRes = await request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(jpeg);
    expect(secondRes.status).toBe(503);
    expect(secondRes.headers['retry-after']).toBe('1');

    release();
    const firstRes = await firstP;
    expect(firstRes.status).toBe(200);
  });

  it('returns 500 when the processing impl throws', async () => {
    const app = createImageWorkerApp({
      processAvatarImpl: async () => {
        throw new Error('sharp blew up');
      },
    });
    const res = await request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(await makeJpeg());
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/sharp blew up/);
  });

  it('admits up to maxConcurrent requests in parallel without queueing', async () => {
    let inFlightPeak = 0;
    let inFlight = 0;
    const app = createImageWorkerApp({
      maxConcurrent: 2,
      semaphoreWaitMs: 200,
      processAvatarImpl: async (data) => {
        inFlight++;
        if (inFlight > inFlightPeak) inFlightPeak = inFlight;
        await new Promise((r) => setTimeout(r, 30));
        try {
          return await processAvatar(data);
        } finally {
          inFlight--;
        }
      },
    });

    const jpeg = await makeJpeg();
    const fire = () =>
      request(app)
        .post('/process/avatar')
        .set('Content-Type', 'application/octet-stream')
        .send(jpeg);
    const [a, b] = await Promise.all([fire(), fire()]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(inFlightPeak).toBe(2);
  });

  it('queued requests acquire the slot when a holder releases before timeout', async () => {
    let firstAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      firstAcquired = resolve;
    });
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    let callCount = 0;
    const app = createImageWorkerApp({
      maxConcurrent: 1,
      semaphoreWaitMs: 1000,
      processAvatarImpl: async (data) => {
        callCount++;
        if (callCount === 1) {
          firstAcquired();
          await blocker;
        }
        return processAvatar(data);
      },
    });

    const jpeg = await makeJpeg();
    const firstP = request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(jpeg)
      .then((r) => r);
    await acquired;

    const secondP = request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(jpeg)
      .then((r) => r);

    await new Promise((r) => setTimeout(r, 50));
    release();

    const [firstRes, secondRes] = await Promise.all([firstP, secondP]);
    expect(firstRes.status).toBe(200);
    expect(secondRes.status).toBe(200);
  });

  it('returns 503 for every surplus request that arrives while the cap is held', async () => {
    let firstAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      firstAcquired = resolve;
    });
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const app = createImageWorkerApp({
      maxConcurrent: 1,
      semaphoreWaitMs: 100,
      processAvatarImpl: async (data) => {
        firstAcquired();
        await blocker;
        return processAvatar(data);
      },
    });

    const jpeg = await makeJpeg();
    const firstP = request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(jpeg)
      .then((r) => r);
    await acquired;

    const surplus = await Promise.all(
      [0, 1, 2].map(() =>
        request(app)
          .post('/process/avatar')
          .set('Content-Type', 'application/octet-stream')
          .send(jpeg),
      ),
    );

    for (const res of surplus) {
      expect(res.status).toBe(503);
      expect(res.headers['retry-after']).toBe('1');
    }

    release();
    const firstRes = await firstP;
    expect(firstRes.status).toBe(200);
  });

  it('releases the slot to queued waiters when the holder throws', async () => {
    let firstAcquired!: () => void;
    const acquired = new Promise<void>((resolve) => {
      firstAcquired = resolve;
    });
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    let callCount = 0;
    const app = createImageWorkerApp({
      maxConcurrent: 1,
      semaphoreWaitMs: 1000,
      processAvatarImpl: async (data) => {
        callCount++;
        if (callCount === 1) {
          firstAcquired();
          await blocker;
          throw new Error('holder failed mid-process');
        }
        return processAvatar(data);
      },
    });

    const jpeg = await makeJpeg();
    const firstP = request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(jpeg)
      .then((r) => r);
    await acquired;

    const secondP = request(app)
      .post('/process/avatar')
      .set('Content-Type', 'application/octet-stream')
      .send(jpeg)
      .then((r) => r);
    await new Promise((r) => setTimeout(r, 50));

    release();

    const [firstRes, secondRes] = await Promise.all([firstP, secondP]);
    expect(firstRes.status).toBe(500);
    expect(secondRes.status).toBe(200);
  });
});
