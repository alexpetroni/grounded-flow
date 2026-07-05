import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ChatModule } from '../apps/api/src/chat/chat.module';
import type { OpenAIChunk } from '@app/llm';

describe('POST /v1/chat/completions (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ChatModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // Regression: OpenAI's protocol default is non-streaming — an omitted
  // `stream` must yield one JSON completion body, not SSE frames.
  it('returns a single JSON completion when stream is omitted (OpenAI default)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hello' }] })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.object).toBe('chat.completion');
    expect(res.body.id).toMatch(/^chatcmpl-/);
    expect(res.body.choices[0].finish_reason).toBe('stop');
    expect(res.body.choices[0].message.role).toBe('assistant');
    expect(res.body.choices[0].message.content.length).toBeGreaterThan(0);
  });

  it('returns a single JSON completion for explicit stream:false', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hello' }], stream: false })
      .expect(200);

    expect(res.body.object).toBe('chat.completion');
  });

  it('returns SSE stream with correct Content-Type', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hello' }], stream: true })
      .expect(200);

    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
  });

  it('stream contains OpenAI-shaped chunks and terminates with [DONE]', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .send({ messages: [{ role: 'user', content: 'Hello' }], stream: true });

    // supertest sets res.text for text/* content types
    const body: string = res.text;
    const lines = body
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => l.slice('data: '.length).trim());

    expect(lines[lines.length - 1]).toBe('[DONE]');

    const chunks = lines.filter((l) => l !== '[DONE]').map((l) => JSON.parse(l) as OpenAIChunk);

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.object).toBe('chat.completion.chunk');
      expect(chunk.id).toMatch(/^chatcmpl-/);
      expect(Array.isArray(chunk.choices)).toBe(true);
    }

    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.choices[0].finish_reason).toBe('stop');
  });

  it('returns 400 for missing messages field', async () => {
    await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .send({ model: 'gpt-4o' })
      .expect(400);
  });

  it('returns 400 for empty messages array', async () => {
    await request(app.getHttpServer())
      .post('/v1/chat/completions')
      .send({ messages: [] })
      .expect(400);
  });
});
