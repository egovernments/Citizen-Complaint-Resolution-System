import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CoreAdminContext, Form } from 'ra-core';
import { HierarchyLevelEditor } from './HierarchyLevelEditor';

const renderLevels = (names: string[]) =>
  render(
    <CoreAdminContext>
      <Form record={{ boundaryHierarchy: names.map((boundaryType) => ({ boundaryType, parentBoundaryType: null })) }}>
        <HierarchyLevelEditor />
      </Form>
    </CoreAdminContext>,
  );

// #2803: the management screen's Create Boundary Hierarchy says under a level name what can't be saved.
describe('HierarchyLevelEditor level names', () => {
  it('marks a name over 64 characters and a repeated name, under the field', () => {
    renderLevels(['County', 'x'.repeat(65), 'county']);
    const [county, long, again] = screen.getAllByPlaceholderText('e.g. County');
    expect(county).not.toHaveAttribute('aria-invalid', 'true');
    expect(long).toHaveAttribute('aria-invalid', 'true');
    expect(again).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('This name is 65 characters long. Use 64 characters or fewer.')).toBeInTheDocument();
    expect(screen.getByText(/^Level 1 \("County"\) already has this name\./)).toBeInTheDocument();
  });

  it('says nothing under good or blank names', () => {
    renderLevels(['County', 'Ward', '']);
    expect(screen.queryByText(/characters long|already has this name/)).not.toBeInTheDocument();
  });
});
