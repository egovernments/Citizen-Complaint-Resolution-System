/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const { uploadComplaintTypeLocalizations, cacheBust } = vi.hoisted(() => ({
  uploadComplaintTypeLocalizations: vi.fn().mockResolvedValue({ success: 3, failed: 0 }),
  cacheBust: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/api/services/localization', () => ({
  localizationService: { uploadComplaintTypeLocalizations, cacheBust },
}));
vi.mock('@/providers/bridge', () => ({ digitClient: { stateTenantId: 'ke' } }));
vi.mock('ra-core', () => ({ useLocaleState: () => ['en_IN', vi.fn()] }));

// Capture the props passed to DigitEdit so we can invoke afterUpdate directly.
const captured = vi.hoisted(() => ({ props: null as any }));
vi.mock('@/admin', () => ({
  DigitEdit: (props: any) => {
    captured.props = props;
    return <div>{props.children}</div>;
  },
  DigitFormInput: () => <div />,
  DigitFormSelect: () => <div />,
  v: { required: () => undefined, name: () => undefined, slaHours: () => undefined },
}));
vi.mock('@/admin/fields', () => ({ FieldSection: ({ children }: any) => <div>{children}</div> }));
vi.mock('@/admin/widgets', () => ({ BooleanInput: () => <div /> }));

import { ComplaintTypeEdit } from './ComplaintTypeEdit';

describe('ComplaintTypeEdit', () => {
  it('re-seeds the sub-type name labels for the active locale only, without touching the parent type label', async () => {
    render(<ComplaintTypeEdit />);
    await captured.props.afterUpdate({
      serviceCode: 'WaterOutage',
      name: 'No water supply',
      department: 'WATER_ENV',
      menuPath: 'WaterAndSanitation',
    });

    // Active locale only, and NO menuPath in the payload → parent type label
    // (SERVICEDEFS.<menuPath>) is never overwritten by a sub-type edit.
    expect(uploadComplaintTypeLocalizations).toHaveBeenCalledTimes(1);
    expect(uploadComplaintTypeLocalizations).toHaveBeenCalledWith(
      'ke',
      [{ serviceCode: 'WaterOutage', name: 'No water supply', department: 'WATER_ENV' }],
      'en_IN',
    );
    expect(cacheBust).toHaveBeenCalled();
  });

  it('skips seeding when serviceCode or name is missing', async () => {
    uploadComplaintTypeLocalizations.mockClear();
    render(<ComplaintTypeEdit />);
    await captured.props.afterUpdate({ serviceCode: 'WaterOutage' }); // no name
    expect(uploadComplaintTypeLocalizations).not.toHaveBeenCalled();
  });
});
