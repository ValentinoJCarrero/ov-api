import { Module } from '@nestjs/common';
import { TokenUsageService } from './token-usage.service';
import { TokenUsageController } from './token-usage.controller';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [BusinessModule],
  providers: [TokenUsageService],
  controllers: [TokenUsageController],
})
export class TokenUsageModule {}
