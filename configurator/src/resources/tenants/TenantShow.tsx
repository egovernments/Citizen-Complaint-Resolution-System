import { DigitShow } from '@/admin';
import { LabelFieldPair, CardLabel, Field } from '@/components/digit/LabelFieldPair';
import { useRecordContext } from 'ra-core';

function TenantDetail() {
  const record = useRecordContext();
  if (!record) return null;

  const city = record.city as Record<string, unknown> | undefined;
  const dash = (val: unknown) => {
    const s = typeof val === 'string' ? val.trim() : '';
    return s
      ? <Field>{s}</Field>
      : <Field><span className="text-muted-foreground">—</span></Field>;
  };

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
        <CardLabel>Description</CardLabel>
        {dash(record.description)}
      </LabelFieldPair>
      <LabelFieldPair>
        <CardLabel>Helpline number</CardLabel>
        {dash(record.contactNumber)}
      </LabelFieldPair>
      <LabelFieldPair>
        <CardLabel>Email</CardLabel>
        {dash(record.emailId)}
      </LabelFieldPair>
      <LabelFieldPair>
        <CardLabel>Address</CardLabel>
        {dash(record.address)}
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
    <DigitShow title="Tenant Details" hasEdit>
      <TenantDetail />
    </DigitShow>
  );
}
