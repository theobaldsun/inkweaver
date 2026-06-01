/**
 * 后端服务入口（NestJS）。
 *
 * 用途：
 * - 启动 NestJS 应用，装配全局校验、CORS、基础中间件
 *
 * 输入：环境变量（如 PORT、CORS_ORIGIN 等）
 * 输出：启动 HTTP 服务（监听端口）
 */
import "reflect-metadata";

import { ValidationPipe, HttpException, HttpStatus } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { createLogger } from "@inkweaver/shared";
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const logger = createLogger({ scope: "server" });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
    logger: console,
  });

  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  // 增加请求体大小限制
  app.use(bodyParser.json({ limit: '100mb' }));
  app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

  // 全局错误处理
  app.useGlobalFilters({
    catch: (exception: any, host: any) => {
      const ctx = host.switchToHttp();
      const response = ctx.getResponse();
      const request = ctx.getRequest();

      console.error('Global error:', exception);

      if (exception instanceof HttpException) {
        const status = exception.getStatus();
        response
          .status(status)
          .json({
            statusCode: status,
            timestamp: new Date().toISOString(),
            path: request.url,
            message: exception.message,
          });
      } else {
        response
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .json({
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            timestamp: new Date().toISOString(),
            path: request.url,
            message: exception.message || 'Internal server error',
            stack: exception.stack,
          });
      }
    },
  });

  // Swagger 配置
  const config = new DocumentBuilder()
    .setTitle('InkWeaver API')
    .setDescription('InkWeaver API description')
    .setVersion('1.0')
    .addTag('InkWeaver')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT ?? "3000");
  await app.listen(port);
  logger.info("server started", { port });
  console.log(`Server running on http://localhost:${port}`);
}

bootstrap().catch((err: unknown) => {
  const logger = createLogger({ scope: "server" });
  logger.error("server bootstrap failed", err);
  console.error('Bootstrap error:', err);
  process.exitCode = 1;
});

