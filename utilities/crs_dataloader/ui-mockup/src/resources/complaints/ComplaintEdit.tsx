import { DigitEdit, DigitFormInput } from '@/admin';

export function ComplaintEdit() {
  return (
    <DigitEdit title="Update Complaint">
      <DigitFormInput source="serviceRequestId" label="Request ID" disabled />
      <DigitFormInput source="applicationStatus" label="Current Status" disabled />
      <DigitFormInput source="description" label="Description" disabled />
    </DigitEdit>
  );
}
