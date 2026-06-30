// Config Service - per-tenant config-service records (notification channel toggles)
import { apiClient, ApiClientError } from '../client';
import { ENDPOINTS, CONFIG_SCHEMAS } from '../config';

const SCHEMA = CONFIG_SCHEMAS.NOTIFICATION_CHANNEL;

/** A NotificationChannel config record (data payload). `enabled` is the per-tenant
 *  toggle the novu-bridge gates dispatch on; `providerName` links to a ProviderDetail. */
export interface NotificationChannelConfig {
  code: string;            // WHATSAPP | SMS | EMAIL
  name: string;
  enabled: boolean;
  providerName?: string;
  priority?: number;
}

interface ConfigDataRecord {
  id?: string;
  uniqueIdentifier?: string;
  data: NotificationChannelConfig;
}

function isDuplicate(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    return err.errors.some((e) =>
      /DUPLICATE|already exist|unique/i.test(`${e.code} ${e.message}`)
    );
  }
  return false;
}

export const configService = {
  /** Active NotificationChannel records for a tenant (used to pre-populate the toggles).
   *  isActive:true mirrors the novu-bridge gate and config-service _resolve — so a soft-deleted
   *  record doesn't pre-populate a toggle with stale state. (The reconcile search in
   *  upsertNotificationChannel stays broad so it can locate + revive a soft-deleted duplicate.) */
  async getNotificationChannels(tenantId: string): Promise<NotificationChannelConfig[]> {
    const response = await apiClient.post(ENDPOINTS.CONFIG_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      criteria: { tenantId, schemaCode: SCHEMA, isActive: true },
    });
    const records = ((response as { configData?: ConfigDataRecord[] }).configData || []);
    return records.map((r) => r.data).filter(Boolean);
  },

  /**
   * Create-or-update a single channel toggle. config-service has no upsert, and the schema
   * is x-unique on `code`, so we try _create first and reconcile via _update on a duplicate
   * (mirrors local-setup/db/notif-mdms-seed/seed.sh).
   */
  async upsertNotificationChannel(
    tenantId: string,
    channel: NotificationChannelConfig
  ): Promise<void> {
    const uid = `${tenantId}.${channel.code}`;
    const configData = {
      tenantId,
      uniqueIdentifier: uid,
      schemaCode: SCHEMA,
      isActive: true,
      data: channel,
    };

    try {
      await apiClient.post(`${ENDPOINTS.CONFIG_CREATE}/${SCHEMA}`, {
        RequestInfo: apiClient.buildRequestInfo(),
        configData,
      });
      return;
    } catch (err) {
      if (!isDuplicate(err)) throw err;
    }

    // Duplicate -> find the existing row (match on data.code, case-insensitively) and update it in
    // place, keeping whatever uniqueIdentifier/id it already carries.
    const search = await apiClient.post(ENDPOINTS.CONFIG_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo(),
      criteria: { tenantId, schemaCode: SCHEMA },
    });
    const existing = ((search as { configData?: ConfigDataRecord[] }).configData || [])
      .find((r) => r.data?.code?.toUpperCase() === channel.code.toUpperCase());

    // config-service _update hard-requires a valid id; sending undefined yields a misleading
    // INVALID_ID. If the duplicate can't be located, fail with a clear message instead.
    if (!existing?.id) {
      throw new Error(
        `Channel ${channel.code} already exists for ${tenantId} but could not be located to update.`
      );
    }

    await apiClient.post(`${ENDPOINTS.CONFIG_UPDATE}/${SCHEMA}`, {
      RequestInfo: apiClient.buildRequestInfo(),
      configData: {
        ...configData,
        id: existing.id,
        uniqueIdentifier: existing.uniqueIdentifier || uid,
      },
    });
  },

  /**
   * Persist all channel toggles for a tenant. Best-effort: every channel is attempted (config-service
   * has no transaction), and if any fail the others are still saved and a combined error is thrown so
   * the caller can report exactly what didn't save rather than masking partial success.
   */
  async saveNotificationChannels(
    tenantId: string,
    channels: NotificationChannelConfig[]
  ): Promise<void> {
    const results = await Promise.allSettled(
      channels.map((channel) => this.upsertNotificationChannel(tenantId, channel))
    );
    const failures = results
      .map((r, i) => ({ r, code: channels[i].code }))
      .filter((x) => x.r.status === 'rejected');
    if (failures.length) {
      const detail = failures
        .map((f) => {
          const reason = (f.r as PromiseRejectedResult).reason;
          const msg = reason instanceof ApiClientError ? reason.firstError
            : reason instanceof Error ? reason.message : String(reason);
          return `${f.code}: ${msg}`;
        })
        .join('; ');
      throw new Error(`Failed to save ${failures.length} of ${channels.length} channels — ${detail}`);
    }
  },
};
