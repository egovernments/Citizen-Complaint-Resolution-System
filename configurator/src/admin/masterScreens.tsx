import { useMemo } from 'react';
import { useResourceContext } from 'ra-core';
import type { RaRecord } from 'ra-core';
import {
  DigitList as BaseDigitList,
  DigitDatagrid as BaseDigitDatagrid,
  type DigitListProps,
  type DigitDatagridProps,
  type DigitColumn,
} from '@digit-ui/datagrid';
import { getResourceConfig } from '@/providers/bridge';
import { StatusChip } from './fields';

/**
 * Data-provider meta sent only by the configurator's master screens
 * (List / Show / Edit). It makes MDMS getList/getOne/update include records
 * whose root-level isActive is false, so they can be viewed and re-enabled.
 * Every other consumer of a master (reference dropdowns, lookups, EntityLink,
 * reverse-reference lists) omits it and keeps seeing active records only
 * (egovernments/CCRS#1846).
 */
export const MASTER_SCREEN_META = { showInactive: true } as const;

/** DigitList for master screens: lists deactivated MDMS records too. */
export function DigitList(props: DigitListProps) {
  return <BaseDigitList {...props} meta={{ ...MASTER_SCREEN_META, ...props.meta }} />;
}

/**
 * DigitDatagrid for master screens. Inline edits and row deletes carry
 * MASTER_SCREEN_META, since the rows they act on may be deactivated. It also
 * appends a Status column bound to the MDMS record's root-level isActive
 * (`_isActive`) when the resource is an MDMS master and the caller didn't
 * define one. The complaint-type leaf adapter is skipped (its list defines its
 * own status column).
 */
export function DigitDatagrid<RecordType extends RaRecord = RaRecord>(props: DigitDatagridProps<RecordType>) {
  const contextResource = useResourceContext();
  const { columns: baseColumns, mutationOptions } = props;
  const columns = useMemo<DigitColumn<RecordType>[]>(() => {
    const config = contextResource ? getResourceConfig(contextResource) : undefined;
    const needsStatus =
      config?.type === 'mdms' &&
      !config.leafServiceDefAdapter &&
      !baseColumns.some((col) => col.source === '_isActive');
    if (!needsStatus) return baseColumns;
    return [
      ...baseColumns,
      {
        source: '_isActive',
        label: 'app.fields.status',
        sortable: false,
        render: (record) => (
          <StatusChip value={record._isActive} labels={{ true: 'Active', false: 'Inactive' }} />
        ),
      },
    ];
  }, [baseColumns, contextResource]);
  const masterMutationOptions = useMemo(
    () => ({ ...mutationOptions, meta: { ...MASTER_SCREEN_META, ...mutationOptions?.meta } }),
    [mutationOptions],
  );
  return <BaseDigitDatagrid {...props} columns={columns} mutationOptions={masterMutationOptions} />;
}
