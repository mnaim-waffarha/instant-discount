import { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { badRequest } from './api-error';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw badRequest(
        result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      );
    }
    return result.data;
  }
}
