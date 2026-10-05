import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { corsOrigins } from './config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS_ORIGINS: a central deployment holding a Geoapify key should list the
  // configurator origins it serves. The '*' default suits local dev and
  // same-origin deployments, where the nginx /turbopass/ proxy means CORS
  // never applies.
  app.enableCors({ origin: corsOrigins(process.env.CORS_ORIGINS) });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
