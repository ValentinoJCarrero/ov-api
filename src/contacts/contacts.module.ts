import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { BusinessModule } from '../business/business.module';

@Module({
  imports: [BusinessModule],
  providers: [ContactsService],
  controllers: [ContactsController],
  exports: [ContactsService],
})
export class ContactsModule {}
