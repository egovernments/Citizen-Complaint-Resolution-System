import { describe, it, expect } from 'vitest';
import {
  CHANNEL_CHOICES,
  NO_CHANNEL,
  SOURCE_PATH_CHOICES,
  channelDisplay,
  isChannelless,
  maskRecipient,
  recipientDisplay,
  sourcePathDisplay,
} from './notificationLogDisplay';
// The filter → query-param mapping the data provider actually uses. Imported by
// path rather than through '@digit-mcp/data-provider' on purpose: the package
// index pulls in json-logic-js, which is not installed in this workspace, so
// the barrel cannot be loaded in a test. This module has no imports at all.
import { buildNotificationLogQuery } from '../../../packages/data-provider/src/providers/notificationLogQuery';

describe('channel filter choices', () => {
  it('offers the channel-less rows, so filtering by channel cannot hide them', () => {
    const none = CHANNEL_CHOICES.find((c) => c.id === NO_CHANNEL);
    expect(none, 'NONE must be a choice, not a "clear the filter" workaround').toBeDefined();
    // The label has to say what it means in words — "NONE" alone reads as a bug.
    expect(none!.name.toLowerCase()).toContain('no channel');
    expect(none!.name.toLowerCase()).toContain('nothing sent');
  });

  it('uses the API enum values verbatim as ids', () => {
    expect(CHANNEL_CHOICES.map((c) => c.id)).toEqual(['SMS', 'EMAIL', 'WHATSAPP', 'NONE']);
  });
});

describe('source path choices', () => {
  it('are exactly the API enum, labelled in plain words', () => {
    expect(SOURCE_PATH_CHOICES.map((c) => c.id)).toEqual(['PRERENDERED', 'RESOLVED']);
    expect(SOURCE_PATH_CHOICES.map((c) => c.name)).toEqual([
      'Sent as finished message',
      'Routed by notifications',
    ]);
  });
});

describe('channelDisplay', () => {
  it('names the real channels', () => {
    expect(channelDisplay('SMS')).toEqual({ text: 'SMS', muted: false });
    expect(channelDisplay('EMAIL')).toEqual({ text: 'Email', muted: false });
    expect(channelDisplay('WHATSAPP')).toEqual({ text: 'WhatsApp', muted: false });
  });

  it('renders a channel-less row as words, muted', () => {
    expect(channelDisplay('NONE')).toEqual({ text: 'No channel', muted: true });
    expect(channelDisplay('none')).toEqual({ text: 'No channel', muted: true });
  });

  it('shows an unknown channel verbatim instead of blanking the cell', () => {
    // e.g. UNKNOWN, which the bridge writes on an envelope rejection that
    // carried no channel at all.
    expect(channelDisplay('UNKNOWN')).toEqual({ text: 'UNKNOWN', muted: false });
  });

  it('falls back to -- when there is nothing at all', () => {
    expect(channelDisplay(undefined)).toEqual({ text: '--', muted: true });
    expect(channelDisplay('')).toEqual({ text: '--', muted: true });
  });
});

describe('sourcePathDisplay', () => {
  it('translates both API values', () => {
    expect(sourcePathDisplay('PRERENDERED')).toEqual({ text: 'Sent as finished message', muted: false });
    expect(sourcePathDisplay('RESOLVED')).toEqual({ text: 'Routed by notifications', muted: false });
  });

  it('shows an unrecognised value verbatim', () => {
    expect(sourcePathDisplay('FUTURE_PATH')).toEqual({ text: 'FUTURE_PATH', muted: false });
  });

  it('is empty, not broken, on a row from a bridge that had no such column', () => {
    expect(sourcePathDisplay(null)).toEqual({ text: '--', muted: true });
  });
});

describe('recipientDisplay', () => {
  it('masks a phone number to its last three digits', () => {
    expect(recipientDisplay({ channel: 'SMS', recipientValue: '919876543210' }))
      .toEqual({ text: '***210', muted: false });
  });

  it('masks an email but keeps the domain', () => {
    expect(recipientDisplay({ channel: 'EMAIL', recipientValue: 'asha@example.org' }))
      .toEqual({ text: 'a***@example.org', muted: false });
  });

  it('shows the literal "none" of a channel-less row untouched', () => {
    // Masking it produces "***one", which reads as a redacted contact that
    // never existed. This is the trap the screen used to fall into.
    const cell = recipientDisplay({ channel: 'NONE', recipientValue: 'none' });
    expect(cell.text).toBe('none');
    expect(cell.muted).toBe(true);
  });

  it('says "none" on a channel-less row even when the value is missing', () => {
    expect(recipientDisplay({ channel: 'NONE' })).toEqual({ text: 'none', muted: true });
  });

  it('falls back to -- for a channelled row with no recipient', () => {
    expect(recipientDisplay({ channel: 'SMS', recipientValue: '' })).toEqual({ text: '--', muted: true });
  });
});

describe('maskRecipient', () => {
  it('never returns the input for a value long enough to identify someone', () => {
    expect(maskRecipient('9876543210')).not.toContain('9876');
  });

  it('collapses a very short value entirely', () => {
    expect(maskRecipient('12')).toBe('***');
  });
});

describe('isChannelless', () => {
  it('is true only for the NONE pseudo-channel', () => {
    expect(isChannelless({ channel: 'NONE' })).toBe(true);
    expect(isChannelless({ channel: 'SMS' })).toBe(false);
    expect(isChannelless({})).toBe(false);
  });
});

describe('buildNotificationLogQuery', () => {
  it('pages with the API\'s limit/offset', () => {
    const q = buildNotificationLogQuery({}, 3, 25);
    expect(q.limit).toBe(25);
    expect(q.offset).toBe(50);
  });

  it('passes channel NONE straight through, so the filter really queries the server', () => {
    expect(buildNotificationLogQuery({ channel: 'NONE' }, 1, 10).channel).toBe('NONE');
  });

  it('passes sourcePath through under the API parameter name', () => {
    const q = buildNotificationLogQuery({ sourcePath: 'RESOLVED' }, 1, 10);
    expect(q.sourcePath).toBe('RESOLVED');
    expect(Object.keys(q)).toContain('sourcePath');
  });

  it('turns a typed complaint fragment into a prefix search', () => {
    const q = buildNotificationLogQuery({ referenceNumber: 'PG-2026' }, 1, 10);
    expect(q.referenceNumber).toBe('PG-2026');
    expect(q.referenceNumberPrefix).toBe(true);
  });

  it('does not ask for a prefix match when nothing was typed', () => {
    expect(buildNotificationLogQuery({ referenceNumber: '' }, 1, 10).referenceNumberPrefix).toBeUndefined();
  });

  it('forwards the test-sends toggle, which the select holds as the string "true"', () => {
    expect(buildNotificationLogQuery({ includeTest: 'true' }, 1, 10).includeTest).toBe(true);
    expect(buildNotificationLogQuery({ includeTest: true }, 1, 10).includeTest).toBe(true);
  });

  it('omits the toggle when it is cleared, rather than sending includeTest=false', () => {
    expect(buildNotificationLogQuery({ includeTest: '' }, 1, 10).includeTest).toBeUndefined();
    expect(buildNotificationLogQuery({}, 1, 10).includeTest).toBeUndefined();
  });

  it('drops empty filters instead of sending blank parameters', () => {
    const q = buildNotificationLogQuery({ channel: '', status: '', sourcePath: '', transactionId: '' }, 1, 10);
    expect(q.channel).toBeUndefined();
    expect(q.status).toBeUndefined();
    expect(q.sourcePath).toBeUndefined();
    expect(q.transactionId).toBeUndefined();
  });

  it('ignores a filter value that is not a string', () => {
    expect(buildNotificationLogQuery({ status: { bad: 1 } }, 1, 10).status).toBeUndefined();
  });
});
