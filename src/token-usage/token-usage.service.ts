import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TokenUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(businessId?: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const where = businessId ? { businessId } : {};

    const [todayAgg, monthAgg, byCallType, dailyRaw] = await Promise.all([
      this.prisma.tokenUsageLog.aggregate({
        where: { ...where, createdAt: { gte: todayStart } },
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
      }),
      this.prisma.tokenUsageLog.aggregate({
        where: { ...where, createdAt: { gte: monthStart } },
        _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
      }),
      this.prisma.tokenUsageLog.groupBy({
        by: ['callType'],
        where,
        _sum: { totalTokens: true },
        _count: { id: true },
      }),
      this.prisma.tokenUsageLog.findMany({
        where: { ...where, createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true, totalTokens: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      today: this.buildStat(todayAgg._sum),
      thisMonth: this.buildStat(monthAgg._sum),
      byCallType: byCallType.map((r) => ({
        callType: r.callType,
        totalTokens: r._sum.totalTokens ?? 0,
        count: r._count.id,
      })),
      dailySummary: this.aggregateByDay(dailyRaw),
    };
  }

  private buildStat(sum: {
    promptTokens: number | null;
    completionTokens: number | null;
    totalTokens: number | null;
  }) {
    const pt = sum.promptTokens ?? 0;
    const ct = sum.completionTokens ?? 0;
    const tt = sum.totalTokens ?? 0;
    // gpt-4o-mini pricing: input=$0.15/1M tokens, output=$0.60/1M tokens
    const cost = (pt / 1_000_000) * 0.15 + (ct / 1_000_000) * 0.6;
    return {
      promptTokens: pt,
      completionTokens: ct,
      totalTokens: tt,
      estimatedCostUsd: +cost.toFixed(6),
    };
  }

  private aggregateByDay(rows: { createdAt: Date; totalTokens: number }[]) {
    const byDate: Record<string, number> = {};
    for (const r of rows) {
      const d = r.createdAt.toISOString().split('T')[0];
      byDate[d] = (byDate[d] ?? 0) + r.totalTokens;
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, totalTokens]) => ({ date, totalTokens }));
  }
}
