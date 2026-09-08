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

import { createLogger } from "@inkweaver/shared";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';

import { AppModule } from "./app.module";
import { GlobalHttpExceptionFilter } from './common/global-http-exception.filter';
import {
  getAppRuntimeConfig,
  assertStrongSecretsInProduction,
} from "./config/app.config";
import { ObjectStorageService } from "./modules/storage/object-storage.service";
import { createUploadsMiddleware } from "./modules/storage/uploads.middleware";

async function bootstrap(): Promise<void> {
  const logger = createLogger({ scope: "server" });
  const nodeEnv = process.env.NODE_ENV || 'development';
  const corsOrigin = process.env.CORS_ORIGIN;

  // CORS 配置：读取环境变量白名单，多个 origin 用逗号分隔
  // 开发环境未配置时允许所有来源；生产环境必须显式配置，否则只允许 APP_PUBLIC_URL
  let corsOptions: boolean | Record<string, unknown>;
  if (corsOrigin) {
    const origins = corsOrigin.split(',').map(o => o.trim());
    corsOptions = { origin: origins, credentials: true };
  } else if (nodeEnv === 'production') {
    const fallback = process.env.APP_PUBLIC_URL || '';
    logger.warn(`CORS_ORIGIN 未配置，生产环境仅允许: ${fallback || '(未配置，CORS 已禁用)'}`);
    corsOptions = fallback
      ? { origin: fallback, credentials: true }
      : { origin: false };
  } else {
    corsOptions = true;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: corsOptions,
    logger: console,
  });

  const objectStorage = app.get(ObjectStorageService);
  app.use('/uploads', createUploadsMiddleware(objectStorage));

  // 增加请求体大小限制（JSON/URL-encoded）
  // 文件上传走 multipart/form-data，由 FileInterceptor 单独控制
  app.use(bodyParser.json({ limit: '5mb' }));
  app.use(bodyParser.urlencoded({ limit: '5mb', extended: true }));

  app.useGlobalFilters(new GlobalHttpExceptionFilter());

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
      // transformOptions: {
      //   enableImplicitConversion: true,
      // },
    }),
  );

  const configService = app.get(ConfigService);
  assertStrongSecretsInProduction(configService);
  const { port } = getAppRuntimeConfig(configService);
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
