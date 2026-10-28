import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Prometheus metrics for the API process (scraped at /metrics). */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly inquiries = new Counter({
    name: 'instant_discount_inquiries_total',
    help: 'Discount inquiries by outcome (granted or the not-eligible reason)',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  readonly inquiryDuration = new Histogram({
    name: 'instant_discount_inquiry_duration_seconds',
    help: 'Time to answer an inquiry',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 0.8, 1, 2],
    registers: [this.registry],
  });

  readonly reserveResults = new Counter({
    name: 'instant_discount_reserve_results_total',
    help: 'Results of cap reservations in Redis',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  readonly lifecycle = new Counter({
    name: 'instant_discount_lifecycle_total',
    help: 'Confirm / cancel / refund / expire calls by outcome',
    labelNames: ['action', 'outcome'] as const,
    registers: [this.registry],
  });

  readonly alerts = new Counter({
    name: 'instant_discount_alerts_total',
    help: 'Alerts raised by type and severity',
    labelNames: ['type', 'severity'] as const,
    registers: [this.registry],
  });

  readonly jobDuration = new Histogram({
    name: 'instant_discount_job_duration_seconds',
    help: 'Background job run time (worker)',
    labelNames: ['job', 'outcome'] as const,
    buckets: [0.05, 0.1, 0.5, 1, 5, 15, 30, 60, 120],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'instant_discount_' });
  }
}
