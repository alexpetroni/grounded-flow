import { BadRequestException } from '@nestjs/common';
import type { ZodType, z } from 'zod';

/** Single Zod validation-error contract for every request-body endpoint. */
export function parseOrThrow<T extends ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }
  return result.data;
}
