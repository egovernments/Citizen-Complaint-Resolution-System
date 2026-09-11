import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { OrgNodeData } from './types';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));

import { EmployeeNode } from './EmployeeNode';

function renderNode(data: OrgNodeData) {
  return render(
    <ReactFlowProvider>
      {/* @ts-expect-error minimal NodeProps for test */}
      <EmployeeNode id={data.id} data={data} />
    </ReactFlowProvider>,
  );
}

const base: OrgNodeData = {
  id: 'u1', name: 'Jane Doe', code: 'EMP1', designation: 'CLERK', department: 'HEALTH',
  kind: 'member', inactive: false, inCycle: false, clickable: true,
};

describe('EmployeeNode', () => {
  it('renders name and designation/department', () => {
    renderNode(base);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/CLERK/)).toBeInTheDocument();
  });

  it('navigates to the employee page on click when clickable', () => {
    navigate.mockClear();
    renderNode(base);
    fireEvent.click(screen.getByText('Jane Doe'));
    expect(navigate).toHaveBeenCalledWith('/manage/employees/u1/show');
  });

  it('does not navigate for unresolved nodes', () => {
    navigate.mockClear();
    renderNode({ ...base, kind: 'unresolved', clickable: false, name: 'County GRO (KE_GRO)' });
    fireEvent.click(screen.getByText('County GRO (KE_GRO)'));
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByText(/not an employee/i)).toBeInTheDocument();
  });
});
