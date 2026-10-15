import { DigitCreate } from '@/admin';
import { BoundaryCreateFields } from './BoundaryCreateFields';
import { BoundaryCountyPicker, useStateCounties } from './BoundaryCountyPicker';

export function BoundaryCreate() {
  // ours (#1954): at a state whose boundaries live in its counties, a boundary is created in a chosen county's tree
  const { asks, counties, loading } = useStateCounties();
  if (loading) return null;
  if (asks) return <BoundaryCountyPicker counties={counties} />;
  return (
    <DigitCreate title="Create Boundary">
      <BoundaryCreateFields />
    </DigitCreate>
  );
}
