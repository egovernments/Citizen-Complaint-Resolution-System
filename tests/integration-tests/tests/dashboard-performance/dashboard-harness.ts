import { expect, type BrowserContext, type CDPSession, type Page, type Request, type Response } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDigitToken } from '../utils/auth';

export type Principal = 'full' | 'department' | 'public';

export interface ApiCall {
  url: string;
  method: string;
  status: number | null;
  durationMs: number | null;
  responseBytes: number;
  failed: string | null;
}

export interface DashboardSample {
  schemaVersion: 1;
  runId: string;
  target: string;
  targetSha: string;
  tier: string;
  principal: Principal;
  vus: number;
  virtualUserIndex: number;
  iterationIndex: number;
  repeatIndex: number;
  discardedWarmup: boolean;
  startedAt: string;
  loadStartedAt: string | null;
  loadFinishedAt: string | null;
  success: boolean;
  failure: string | null;
  timings: {
    strictReadyMs: number | null;
    ttfbMs: number | null;
    firstWidgetVisibleMs: number | null;
    productionAllWidgetsReadyMs: number | null;
  };
  network: {
    requestCount: number;
    dashboardRequestCount: number;
    analyticsRoundTrips: number;
    transferBytes: number;
    slowestDashboardCalls: ApiCall[];
    failedDashboardCalls: ApiCall[];
  };
  page: {
    visibleWidgets: number;
    erroredWidgets: number;
    jsHeapUsedBytes: number | null;
    jsHeapTotalBytes: number | null;
    consoleErrors: string[];
    pageErrors: string[];
  };
  telemetry: {
    metricNames: string[];
    traceId: string | null;
    queryTraceHeadersPresent: boolean;
  };
  catalog: {
    packId: string | null;
    reportedRecordCount: number | null;
    persona: string | null;
    scopes: unknown[];
  };
}

const ANALYTICS_QUERY = /\/(?:api|pgr-services\/v2|pgr-analytics)(?:\/v2)?\/analytics(?:\/public)?\/_query(?:\?|$)/;
const DASHBOARD_API = /\/(?:api|pgr-services\/v2|pgr-analytics)(?:\/v2)?\/analytics|\/boundary-service\/|\/egov-mdms-service\/|\/mdms-v2\//;

export function dashboardUrl(baseURL: string, principal: Principal): string {
  const employeePath = process.env.DASHBOARD_EMPLOYEE_PATH || '/digit-ui/employee/dashboard';
  const publicPath = process.env.DASHBOARD_PUBLIC_PATH || '/digit-ui/public-dashboard';
  return new URL(principal === 'public' ? publicPath : employeePath, baseURL).toString();
}

export async function installSession(context: BrowserContext, principal: Principal): Promise<void> {
  if (principal === 'public') {
    await context.addInitScript(() => {
      for (const key of [
        'Employee.token', 'Employee.tenant-id', 'Employee.user-info',
        'token', 'tenant-id', 'user-info',
      ]) localStorage.removeItem(key);
    });
    return;
  }

  const baseURL = required('BASE_URL');
  const tenant = required('DIGIT_TENANT');
  const username = required('DIGIT_USERNAME');
  const password = required('DIGIT_PASSWORD');
  const authTenant = process.env.DASHBOARD_AUTH_TENANT || rootTenant(tenant);
  const token = await getDigitToken({
    baseURL,
    tenant: authTenant,
    username,
    password,
    userType: 'EMPLOYEE',
  });

  await context.addInitScript(({ accessToken, userInfo, cityTenant }) => {
    localStorage.setItem('Employee.token', accessToken);
    localStorage.setItem('Employee.tenant-id', cityTenant);
    localStorage.setItem('Employee.user-info', JSON.stringify(userInfo));
    localStorage.setItem('Employee.locale', 'en_IN');
    localStorage.setItem('token', accessToken);
    localStorage.setItem('tenant-id', cityTenant);
    localStorage.setItem('user-info', JSON.stringify(userInfo));
  }, {
    accessToken: token.access_token,
    userInfo: token.UserRequest || {},
    cityTenant: tenant,
  });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rootTenant(tenant: string): string {
  return tenant.includes('.') ? tenant.split('.')[0] : tenant;
}

export class NetworkRecorder {
  readonly calls: ApiCall[] = [];
  readonly metricPayloads: any[] = [];
  readonly logPayloads: any[] = [];
  readonly consoleErrors: string[] = [];
  readonly pageErrors: string[] = [];
  readonly queryHeaders: Record<string, string>[] = [];
  readonly packPayloads: any[] = [];
  readonly queryPayloads: any[] = [];
  private readonly starts = new Map<Request, number>();
  private inFlightDashboard = 0;
  private lastDashboardActivity = 0;
  private active = false;
  private cdp: CDPSession | null = null;
  private encodedBytesAtLastFinish = 0;

  constructor(private readonly page: Page) {}

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.page.on('request', this.onRequest);
    this.page.on('response', this.onResponse);
    this.page.on('requestfinished', this.onFinished);
    this.page.on('requestfailed', this.onFailed);
    this.page.on('console', this.onConsole);
    this.page.on('pageerror', this.onPageError);
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.cdp.send('Network.enable');
    this.cdp.on('Network.loadingFinished', (event) => {
      this.encodedBytesAtLastFinish += Number(event.encodedDataLength) || 0;
    });
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.page.off('request', this.onRequest);
    this.page.off('response', this.onResponse);
    this.page.off('requestfinished', this.onFinished);
    this.page.off('requestfailed', this.onFailed);
    this.page.off('console', this.onConsole);
    this.page.off('pageerror', this.onPageError);
    void this.cdp?.detach();
    this.cdp = null;
  }

  resetCalls(): void {
    this.calls.length = 0;
    this.starts.clear();
    this.inFlightDashboard = 0;
    this.lastDashboardActivity = performance.now();
  }

  analyticsCount(): number {
    return this.calls.filter((call) => ANALYTICS_QUERY.test(call.url)).length;
  }

  encodedTransferBytes(): number {
    return this.encodedBytesAtLastFinish;
  }

  dashboardCalls(): ApiCall[] {
    return this.calls.filter((call) => DASHBOARD_API.test(call.url));
  }

  async waitForDashboardQuiescence(timeoutMs = 60_000, quietMs = 350): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.inFlightDashboard === 0 && performance.now() - this.lastDashboardActivity >= quietMs) return;
      await this.page.waitForTimeout(50);
    }
    throw new Error(`dashboard requests did not quiesce within ${timeoutMs}ms (${this.inFlightDashboard} in flight)`);
  }

  metricNames(): string[] {
    return this.metricPayloads.flatMap((payload) =>
      (payload?.resourceMetrics || []).flatMap((resource: any) =>
        (resource.scopeMetrics || []).flatMap((scope: any) =>
          (scope.metrics || []).map((metric: any) => String(metric.name)),
        ),
      ),
    );
  }

  productionMetric(name: string): number | null {
    const values: number[] = [];
    for (const payload of this.metricPayloads) {
      for (const resource of payload?.resourceMetrics || []) {
        for (const scope of resource.scopeMetrics || []) {
          for (const metric of scope.metrics || []) {
            if (metric.name !== name) continue;
            for (const point of metric.histogram?.dataPoints || []) {
              const count = Number(point.count || 0);
              const sum = Number(point.sum);
              if (count > 0 && Number.isFinite(sum)) values.push(sum / count);
            }
          }
        }
      }
    }
    return values.length ? values.at(-1)! : null;
  }

  traceId(): string | null {
    for (const payload of this.logPayloads) {
      for (const resource of payload?.resourceLogs || []) {
        for (const scope of resource.scopeLogs || []) {
          for (const record of scope.logRecords || []) {
            if (record.traceId) return String(record.traceId);
            const attr = (record.attributes || []).find((item: any) => item.key === 'trace_id');
            if (attr?.value?.stringValue) return String(attr.value.stringValue);
          }
        }
      }
    }
    const header = this.queryHeaders.find((headers) => headers['x-trace-id']);
    return header?.['x-trace-id'] || null;
  }

  private onRequest = (request: Request): void => {
    this.starts.set(request, performance.now());
    if (DASHBOARD_API.test(request.url())) {
      this.inFlightDashboard += 1;
      this.lastDashboardActivity = performance.now();
    }
    if (ANALYTICS_QUERY.test(request.url())) this.queryHeaders.push(request.headers());
    if (request.method() === 'POST' && request.url().includes('/otel/v1/metrics')) {
      this.metricPayloads.push(parseJson(request.postData()));
    }
    if (request.method() === 'POST' && request.url().includes('/otel/v1/logs')) {
      this.logPayloads.push(parseJson(request.postData()));
    }
  };

  private onResponse = async (response: Response): Promise<void> => {
    const request = response.request();
    const call = this.ensureCall(request);
    call.status = response.status();
    const length = Number((await response.allHeaders().catch(() => ({})))['content-length'] || 0);
    if (Number.isFinite(length)) call.responseBytes = length;
    if (response.ok() && /\/analytics(?:\/public)?\/packs(?:\?|$)/.test(response.url())) {
      response.json().then((payload) => this.packPayloads.push(payload)).catch(() => {});
    }
    if (response.ok() && ANALYTICS_QUERY.test(response.url())) {
      response.json().then((payload) => this.queryPayloads.push(payload)).catch(() => {});
    }
  };

  private onFinished = async (request: Request): Promise<void> => {
    const call = this.ensureCall(request);
    call.durationMs = elapsed(this.starts.get(request));
    const sizes = await request.sizes().catch(() => null);
    if (sizes) call.responseBytes = sizes.responseBodySize + sizes.responseHeadersSize;
    this.settled(request);
  };

  private onFailed = (request: Request): void => {
    const call = this.ensureCall(request);
    call.durationMs = elapsed(this.starts.get(request));
    call.failed = request.failure()?.errorText || 'request failed';
    this.settled(request);
  };

  private onConsole = (message: import('@playwright/test').ConsoleMessage): void => {
    if (message.type() === 'error') this.consoleErrors.push(message.text());
  };

  private onPageError = (error: Error): void => {
    this.pageErrors.push(error.message);
  };

  private ensureCall(request: Request): ApiCall {
    let call = this.calls.find((candidate: any) => candidate.__request === request) as any;
    if (!call) {
      call = {
        url: request.url(), method: request.method(), status: null,
        durationMs: null, responseBytes: 0, failed: null,
      };
      Object.defineProperty(call, '__request', { value: request });
      this.calls.push(call);
    }
    return call;
  }

  private settled(request: Request): void {
    if (DASHBOARD_API.test(request.url())) {
      this.inFlightDashboard = Math.max(0, this.inFlightDashboard - 1);
      this.lastDashboardActivity = performance.now();
    }
    this.starts.delete(request);
  }
}

function parseJson(value: string | null): any {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function elapsed(start: number | undefined): number | null {
  return start == null ? null : Math.max(0, performance.now() - start);
}

export async function installPaintProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { firstWidgetVisibleMs: null as number | null };
    (window as any).__dashboardBenchmark = state;
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const check = () => {
      if (state.firstWidgetVisibleMs != null) return;
      const widgets = Array.from(document.querySelectorAll('.dashboard-grid-layout .react-grid-item'));
      const ready = widgets.find((widget) =>
        visible(widget) && !widget.querySelector('.kpi-tile__skeleton, .kpi-tile--loading') &&
        Boolean(widget.textContent?.trim() || widget.querySelector('canvas, svg, table')),
      );
      if (ready) requestAnimationFrame(() => requestAnimationFrame(() => {
        if (state.firstWidgetVisibleMs == null) state.firstWidgetVisibleMs = performance.now();
      }));
    };
    const observer = new MutationObserver(check);
    const start = () => {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      check();
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
}

export async function waitForStrictReady(page: Page, recorder: NetworkRecorder): Promise<number> {
  await expect(page.locator('.dashboard-root')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.dashboard-grid-layout .react-grid-item').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(() => {
    const root = document.querySelector('.dashboard-root');
    const widgets = Array.from(document.querySelectorAll('.dashboard-grid-layout .react-grid-item'));
    if (!root || widgets.length === 0) return false;
    if (root.querySelector('.kpi-tile__skeleton, .kpi-tile--loading, [aria-busy="true"]')) return false;
    return widgets.every((widget) =>
      Boolean(widget.textContent?.trim() || widget.querySelector('canvas, svg, table, .leaflet-container')),
    );
  }, undefined, { timeout: 60_000 });
  await recorder.waitForDashboardQuiescence();
  return page.evaluate(() => new Promise<number>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done(performance.now()))),
  ));
}

export async function heapMetrics(page: Page): Promise<{ used: number | null; total: number | null }> {
  const metrics = await page.evaluate(() => {
    const memory = (performance as any).memory;
    return memory ? { used: Number(memory.usedJSHeapSize), total: Number(memory.totalJSHeapSize) } : null;
  });
  if (metrics) return metrics;
  const session = await page.context().newCDPSession(page);
  const result = await session.send('Performance.getMetrics');
  await session.detach();
  const byName = new Map(result.metrics.map((metric) => [metric.name, metric.value]));
  return {
    used: byName.get('JSHeapUsedSize') ?? null,
    total: byName.get('JSHeapTotalSize') ?? null,
  };
}

export function writeSample(sample: DashboardSample): string {
  const outputDir = resolve(required('DASHBOARD_RESULTS_DIR'), 'samples');
  mkdirSync(outputDir, { recursive: true });
  const kind = sample.discardedWarmup ? 'warmup' : 'sample';
  const path = resolve(outputDir, `${kind}-${String(sample.repeatIndex + 1).padStart(3, '0')}.json`);
  writeFileSync(path, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
  return path;
}

export function queryHasParam(requests: Request[], key: string, expected?: string): boolean {
  return requests.some((request) => {
    const body = parseJson(request.postData());
    const queries = Object.values(body?.queries || {}) as any[];
    return queries.some((query) => {
      const value = query?.params?.[key];
      return value != null && (expected == null || String(value) === expected);
    });
  });
}

export { ANALYTICS_QUERY };
