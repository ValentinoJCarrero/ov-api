import { Controller, Get, Logger } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { BusinessService } from '../business/business.service';

@Controller('admin/contacts')
export class ContactsController {
  private readonly logger = new Logger(ContactsController.name);

  constructor(
    private readonly contactsService: ContactsService,
    private readonly businessService: BusinessService,
  ) {}

  @Get()
  async listAll() {
    const business = await this.businessService.getDefaultBusiness();
    return this.contactsService.listAll(business.id);
  }
}
