import { useMemo, type ReactNode } from 'react';
import { useEditContext, useResourceContext } from 'ra-core';
import { DigitEdit } from '../DigitEdit';
import { DigitFormInput } from '../DigitFormInput';
import { ColorInput } from '../widgets/ColorInput';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { getDescriptor } from '../schemaDescriptors';
import type { FieldGroup, FieldSpec } from '../schemaDescriptors/types';
import { getResourceLabel } from '@/providers/bridge';
import { ThemePreview } from './ThemePreview';
import { HoverContext, useCreateHoverContext, useHoverContext } from './hoverContext';

const SCHEMA = 'common-masters.ThemeConfig';

/** Wraps a ColorInput in mouse/focus handlers so the preview can light up
 *  whichever elements use this token. */
function HoveredColorField({ spec }: { spec: FieldSpec }) {
  const hover = useHoverContext();
  const enter = () => hover?.setHoveredToken(spec.path);
  const leave = () => hover?.setHoveredToken(null);
  return (
    <div onMouseEnter={enter} onMouseLeave={leave} onFocusCapture={enter} onBlurCapture={leave}>
      <ColorInput
        source={spec.path}
        label={spec.label ?? spec.path.split('.').pop()}
        help={spec.help}
      />
    </div>
  );
}

function EditorBody() {
  const descriptor = getDescriptor(SCHEMA);
  const { record, isPending } = useEditContext();
  const hoverValue = useCreateHoverContext();

  const tabs = useMemo<FieldGroup[]>(() => {
    if (!descriptor?.groups) return [];
    return descriptor.groups.filter((g) => g.title !== 'Identity');
  }, [descriptor]);

  const identityFields = useMemo<FieldSpec[]>(() => {
    if (!descriptor) return [];
    const identityGroup = descriptor.groups?.find((g) => g.title === 'Identity');
    const paths = new Set(identityGroup?.fields ?? []);
    return descriptor.fields.filter((f) => paths.has(f.path));
  }, [descriptor]);

  if (isPending || !record) return null;

  return (
    <HoverContext.Provider value={hoverValue}>
      {/* Identity strip */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-3 pb-3 mb-4 border-b border-border">
        {identityFields.map((spec) => (
          <DigitFormInput
            key={spec.path}
            source={spec.path}
            label={spec.label ?? spec.path}
            help={spec.help}
            type="text"
          />
        ))}
      </section>

      {/* Two-column: form + preview */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_480px] gap-6">
        <div className="min-w-0">
          <Tabs defaultValue={tabs[0]?.title ?? ''} className="w-full">
            <TabsList className="flex flex-wrap h-auto gap-1 p-1 w-full justify-start">
              {tabs.map((g) => (
                <TabsTrigger key={g.title} value={g.title} className="text-xs">
                  {g.title}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((g) => (
              <TabsContent key={g.title} value={g.title} className="mt-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {renderGroupFields(g, descriptor?.fields ?? [])}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </div>

        <aside className="xl:sticky xl:top-4 self-start">
          <div className="text-xs font-medium text-muted-foreground mb-2">Live preview</div>
          <ThemePreview />
          <p className="text-[11px] text-muted-foreground mt-2 leading-snug">
            Hover a color on the left — the elements that use it light up here. Edit to see the change live.
          </p>
        </aside>
      </div>
    </HoverContext.Provider>
  );
}

function renderGroupFields(group: FieldGroup, allFields: FieldSpec[]): ReactNode {
  const byPath = new Map(allFields.map((f) => [f.path, f]));
  return group.fields.map((path) => {
    const spec = byPath.get(path);
    if (!spec) return null;
    return <HoveredColorField key={path} spec={spec} />;
  });
}

export function ThemeConfigEditor() {
  const resource = useResourceContext() ?? '';
  const label = getResourceLabel(resource);
  return (
    <DigitEdit title={`Edit ${label}`}>
      <EditorBody />
    </DigitEdit>
  );
}
