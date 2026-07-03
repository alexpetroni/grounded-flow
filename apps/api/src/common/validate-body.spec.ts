import { describe, it, expect } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from './validate-body';

const schema = z.object({ name: z.string().min(1) });

describe('parseOrThrow', () => {
  it('returns the parsed data on success', () => {
    expect(parseOrThrow(schema, { name: 'ok' })).toEqual({ name: 'ok' });
  });

  it('throws BadRequestException with a flattened Zod error on failure', () => {
    try {
      parseOrThrow(schema, {});
      expect.fail('expected parseOrThrow to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse() as {
        fieldErrors: Record<string, string[]>;
      };
      expect(response.fieldErrors).toHaveProperty('name');
    }
  });
});
