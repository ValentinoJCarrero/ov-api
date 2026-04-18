import { Module } from '@nestjs/common';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { GoogleSheetsModule } from '../google-sheets/google-sheets.module';

@Module({
  imports: [GoogleSheetsModule],
  providers: [BusinessService],
  controllers: [BusinessController],
  exports: [BusinessService],
})
export class BusinessModule {}
