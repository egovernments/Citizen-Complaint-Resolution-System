import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SearchService } from './search.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [SearchService],
})
export class AppModule {}
