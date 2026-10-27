import { HttpException, HttpStatus } from '@nestjs/common';

/** Every error response has the shape `{ error: { code, message } }`. */
export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string) {
    super({ error: { code, message } }, status);
  }
}

export const unauthorized = (message: string) =>
  new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message);
export const notFound = (code: string, message: string) =>
  new ApiError(HttpStatus.NOT_FOUND, code, message);
export const conflict = (code: string, message: string) =>
  new ApiError(HttpStatus.CONFLICT, code, message);
export const unprocessable = (code: string, message: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);
export const badRequest = (message: string) =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message);
