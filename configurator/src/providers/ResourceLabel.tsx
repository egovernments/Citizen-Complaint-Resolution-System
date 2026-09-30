import { T } from '@digit-ui/datagrid';
import { getResourceLabel } from '@/providers/bridge';
import { resourceLabelKey } from '@/providers/useResourceLabel';

/**
 * A resource's display label as a `<T>` node, so its localization code shows
 * up in the DOM (`data-i18n-key`). Same key and fallback as `useResourceLabel`;
 * use this wherever the label is rendered as text rather than needed as a string.
 */
export function ResourceLabel({ resource }: { resource: string }) {
  return <T i18nKey={resourceLabelKey(resource)}>{getResourceLabel(resource)}</T>;
}
