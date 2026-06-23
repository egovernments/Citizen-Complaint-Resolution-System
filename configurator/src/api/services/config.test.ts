import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the API client but keep the real ApiClientError (configService uses instanceof).
vi.mock('../client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../client')>();
  return {
    ...actual,
    apiClient: {
      buildRequestInfo: vi.fn(() => ({})),
      post: vi.fn(),
    },
  };
});

import { apiClient, ApiClientError } from '../client';
import { configService } from './config';
import { ENDPOINTS } from '../config';

const post = apiClient.post as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  post.mockReset();
});

describe('configService.upsertNotificationChannel', () => {
  it('creates a new record when none exists', async () => {
    post.mockResolvedValueOnce({}); // _create succeeds

    await configService.upsertNotificationChannel('pb.amritsar', {
      code: 'WHATSAPP',
      name: 'WhatsApp',
      enabled: true,
      providerName: 'twilio',
    });

    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url).toBe(`${ENDPOINTS.CONFIG_CREATE}/NotificationChannel`);
    expect(body.configData.tenantId).toBe('pb.amritsar');
    expect(body.configData.data.enabled).toBe(true);
    expect(body.configData.uniqueIdentifier).toBe('pb.amritsar.WHATSAPP');
  });

  it('reconciles via _update when the record already exists (duplicate)', async () => {
    post
      .mockRejectedValueOnce(new ApiClientError([{ code: 'DUPLICATE_RECORD', message: 'exists' }], 400))
      .mockResolvedValueOnce({
        configData: [
          { id: 'existing-id', uniqueIdentifier: 'legacy-uid', data: { code: 'WHATSAPP', enabled: false } },
        ],
      }) // _search
      .mockResolvedValueOnce({}); // _update

    await configService.upsertNotificationChannel('pb.amritsar', {
      code: 'WHATSAPP',
      name: 'WhatsApp',
      enabled: true,
      providerName: 'twilio',
    });

    expect(post).toHaveBeenCalledTimes(3);
    const [createUrl] = post.mock.calls[0];
    const [searchUrl] = post.mock.calls[1];
    const [updateUrl, updateBody] = post.mock.calls[2];
    expect(createUrl).toBe(`${ENDPOINTS.CONFIG_CREATE}/NotificationChannel`);
    expect(searchUrl).toBe(ENDPOINTS.CONFIG_SEARCH);
    expect(updateUrl).toBe(`${ENDPOINTS.CONFIG_UPDATE}/NotificationChannel`);
    // keeps the existing row's id + uniqueIdentifier, writes the new enabled value
    expect(updateBody.configData.id).toBe('existing-id');
    expect(updateBody.configData.uniqueIdentifier).toBe('legacy-uid');
    expect(updateBody.configData.data.enabled).toBe(true);
  });

  it('rethrows non-duplicate errors instead of updating', async () => {
    post.mockRejectedValueOnce(new ApiClientError([{ code: 'SOME_OTHER_ERROR', message: 'boom' }], 500));

    await expect(
      configService.upsertNotificationChannel('pb.amritsar', { code: 'SMS', name: 'SMS', enabled: true })
    ).rejects.toBeInstanceOf(ApiClientError);
    expect(post).toHaveBeenCalledTimes(1); // no _search / _update attempted
  });
});

describe('configService.getNotificationChannels', () => {
  it('maps configData records to their data payloads', async () => {
    post.mockResolvedValueOnce({
      configData: [
        { id: '1', data: { code: 'WHATSAPP', name: 'WhatsApp', enabled: true } },
        { id: '2', data: { code: 'SMS', name: 'SMS', enabled: false } },
      ],
    });

    const channels = await configService.getNotificationChannels('pb.amritsar');

    expect(channels).toEqual([
      { code: 'WHATSAPP', name: 'WhatsApp', enabled: true },
      { code: 'SMS', name: 'SMS', enabled: false },
    ]);
  });

  it('returns empty when there is no config data', async () => {
    post.mockResolvedValueOnce({});
    expect(await configService.getNotificationChannels('pb.amritsar')).toEqual([]);
  });
});
