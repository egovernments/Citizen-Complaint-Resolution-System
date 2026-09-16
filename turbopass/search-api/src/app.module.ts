import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import { SearchService } from './search.service';
import { BoundaryController } from './boundary.controller';
import { BoundaryService } from './boundary.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    HttpModule,
  ],
  controllers: [AppController, HealthController, BoundaryController],
  providers: [SearchService, BoundaryService],
})
export class AppModule {}
