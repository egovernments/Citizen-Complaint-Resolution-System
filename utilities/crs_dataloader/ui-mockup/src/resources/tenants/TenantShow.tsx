import { DigitShow } from '@/admin';
import { LabelFieldPair, CardLabel, Field } from '@/components/digit/LabelFieldPair';
import { useRecordContext } from 'ra-core';

function TenantDetail() {
  const record = useRecordContext();
  if (!record) return null;

  const city = record.city as Record<string, unknown> | undefined;

  return (
    <div className="space-y-3">
      <LabelFieldPair>
        <CardLabel>Code</CardLabel>
        <Field>{String(record.code ?? '')}</Field>
      </LabelFieldPair>
      <LabelFieldPair>
        <CardLabel>Name</CardLabel>
        <Field>{String(record.name ?? '')}</Field>
      </LabelFieldPair>
      <LabelFieldPair>
        <CardLabel>City</CardLabel>
        <Field>{String(city?.name ?? '')}</Field>
      </LabelFieldPair>
      <LabelFieldPair>
        <CardLabel>District</CardLabel>
        <Field>{String(city?.districtName ?? '')}</Field>
      </LabelFieldPair>
    </div>
  );
}

export function TenantShow() {
  return (
    <DigitShow title="Tenant Details">
      <TenantDetail />
    </DigitShow>
  );
}
