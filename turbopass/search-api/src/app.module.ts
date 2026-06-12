import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import { SearchService } from './search.service';

@Module({
  imports: [],
  controllers: [AppController, HealthController],
  providers: [SearchService],
})
export class AppModule {}
