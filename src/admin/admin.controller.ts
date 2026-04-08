import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { join } from 'path';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller()
export class AdminController {
  @Get('admin')
  servePanelHtml(@Res() res: Response) {
    res.sendFile(join(process.cwd(), 'public', 'admin.html'));
  }

  @Get('dashboard')
  serveOwnerDashboard(@Res() res: Response) {
    res.sendFile(join(process.cwd(), 'public', 'owner.html'));
  }
}
