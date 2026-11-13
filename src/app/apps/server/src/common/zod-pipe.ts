import { type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodSchema } from 'zod';
import { ApiException } from './errors';

/**
 * zod 校验管道：请求体/查询参数不符合 schema 时返回
 * 400 { code: 'VALIDATION_ERROR', issues }。
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const error = result.error as ZodError;
      throw ApiException.validation('请求参数不合法', error.issues);
    }
    return result.data;
  }
}
