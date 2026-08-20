import { Controller, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get('summary')
  async getSummary() {
    return { code: 0, data: await this.service.getSummary() };
  }

  @Get('usage-trends')
  async getUsageTrends() {
    return { code: 0, data: await this.service.getUsageTrends() };
  }

  @Get('recent-activities')
  async getRecentActivities() {
    return { code: 0, data: await this.service.getRecentActivities() };
  }
}
