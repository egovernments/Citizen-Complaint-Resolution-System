import { DigitCreate } from '@/admin';
import { BoundaryCreateFields } from './BoundaryCreateFields';

export function BoundaryCreate() {
  return (
    <DigitCreate title="Create Boundary">
      <BoundaryCreateFields />
    </DigitCreate>
  );
}
