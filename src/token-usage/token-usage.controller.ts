import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity, ApiQuery } from '@nestjs/swagger';
import { TokenUsageService } from './token-usage.service';
import { BusinessService } from '../business/business.service';

@ApiTags('Token Usage')
@ApiSecurity('X-Admin-Api-Key')
@Controller('admin/token-usage')
export class TokenUsageController {
  constructor(
    private readonly tokenUsageService: TokenUsageService,
    private readonly businessService: BusinessService,
  ) {}

  @ApiOperation({ summary: 'Resumen de uso de tokens de OpenAI (hoy, este mes, por tipo, por día)' })
  @ApiQuery({ name: 'businessId', required: false })
  @Get()
  async getSummary(@Query('businessId') businessId?: string) {
    const bid = businessId ?? (await this.businessService.getDefaultBusiness()).id;
    return this.tokenUsageService.getSummary(bid);
  }
}
