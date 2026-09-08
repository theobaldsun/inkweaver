/**
 * 全局 HTTP 异常过滤器。
 * 保留 Nest/class-validator 的详细 message，同时避免在生产响应中暴露内部堆栈。
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

import type { Request, Response } from 'express';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  /** 将任意异常转换为稳定的 JSON 错误协议。 */
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    console.error('Global error:', exception);

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message = typeof payload === 'string'
        ? payload
        : (payload as { message?: string | string[] }).message ?? exception.message;
      response.status(status).json({
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        message,
      });
      return;
    }

    const error = exception instanceof Error ? exception : new Error(String(exception));
    const isDevelopment = process.env.NODE_ENV !== 'production';
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: isDevelopment ? error.message : 'Internal server error',
      ...(isDevelopment && error.stack ? { stack: error.stack } : {}),
    });
  }
}
