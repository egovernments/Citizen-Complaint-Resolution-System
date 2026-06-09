import { DigitFormInput } from '../DigitFormInput';
import { ColorInput } from './ColorInput';
import { RegexInput } from './RegexInput';
import { ChipArrayInput } from './ChipArrayInput';
import { DurationMsInput } from './DurationMsInput';
import { BooleanInput } from './BooleanInput';
import { LocaleListInput } from './LocaleListInput';
import type { FieldSpec } from '../schemaDescriptors/types';

interface WidgetDispatchProps {
  spec: FieldSpec;
  source: string;
}

/** Pick a widget based on spec.widget. Falls back to a plain text input for
 *  anything unrecognized — the user asked for this explicitly: "drop any to
 *  simpler versions (only text edit maybe) that aren't working out."
 *  The source path is used as-is; react-hook-form natively traverses "a.b.c". */
export function WidgetForFieldSpec({ spec, source }: WidgetDispatchProps) {
  const label = spec.label ?? source;
  const shared = { source, label };

  switch (spec.widget) {
    case 'color':
      return <ColorInput {...shared} help={spec.help} />;
    case 'regex':
      return <RegexInput {...shared} help={spec.help} />;
    case 'chip-array':
      return <ChipArrayInput {...shared} help={spec.help} />;
    case 'duration-ms':
      return <DurationMsInput {...shared} help={spec.help} min={spec.min} max={spec.max} />;
    case 'locale-list':
      return <LocaleListInput {...shared} help={spec.help} />;
    case 'boolean':
      return <BooleanInput {...shared} help={spec.help} />;
    case 'integer':
    case 'number':
      return <DigitFormInput {...shared} type="number" help={spec.help} />;
    case 'textarea':
      // No dedicated textarea component yet; fall back to plain text. TODO.
      return <DigitFormInput {...shared} type="text" help={spec.help} />;
    case 'text':
    default:
      return <DigitFormInput {...shared} type="text" help={spec.help} />;
  }
}

export { ColorInput, RegexInput, ChipArrayInput, DurationMsInput, BooleanInput, LocaleListInput };
