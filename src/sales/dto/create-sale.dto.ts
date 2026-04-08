import { IsString, IsNumber, IsOptional, IsEnum, IsDateString, Min } from 'class-validator';
import { SaleSource } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateSaleDto {
  @IsString()
  description: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount: number;

  @IsString()
  @IsOptional()
  contactId?: string;

  @IsEnum(SaleSource)
  @IsOptional()
  source?: SaleSource;

  @IsDateString()
  @IsOptional()
  occurredAt?: string;
}
