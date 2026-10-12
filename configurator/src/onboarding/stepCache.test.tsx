import type { ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Employee, MdmsRecord } from '@/api/types';
import DepartmentsStep from './departments/DepartmentsStep';
import EmployeesStep from './employees/EmployeesStep';
import { listMasters, removeMaster } from './departments/mastersApi';
import { listEmployees, loadEmployeeOptions, removeEmployee, type EmployeeList, type EmployeeOptions } from './employees/employeesApi';
import { loadMembers } from './employees/inviteStatus';

const app = {
  state: { tenant: 'acme', targetTenant: 'acme', completedPhases: [] as number[], user: { uuid: 'me' } },
  completePhase: vi.fn(async () => true),
};
vi.mock('@/App', () => ({ useApp: () => app }));
vi.mock('@/identity/workspace', () => ({ searchWorkspace: vi.fn(async () => ({ Probes: {}, Workspace: { legacy: true } })) }));
vi.mock('./telemetry', () => ({ reportStepError: vi.fn(), trackStepAction: vi.fn() }));
vi.mock('./departments/mastersApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./departments/mastersApi')>()),
  listMasters: vi.fn(),
  removeMaster: vi.fn(),
}));
vi.mock('./employees/employeesApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./employees/employeesApi')>()),
  loadEmployeeOptions: vi.fn(),
  listEmployees: vi.fn(),
  removeEmployee: vi.fn(),
}));
vi.mock('./employees/inviteStatus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./employees/inviteStatus')>()),
  loadMembers: vi.fn(),
}));

const masters = vi.mocked(listMasters);
const options = vi.mocked(loadEmployeeOptions);
const employees = vi.mocked(listEmployees);

const record = (code: string, name: string): MdmsRecord => ({
  id: code,
  tenantId: 'acme',
  schemaCode: 'common-masters.Department',
  uniqueIdentifier: code,
  isActive: true,
  data: { code, name },
});

const employee = (code: string, name: string): Employee =>
  ({
    code,
    uuid: `e-${code}`,
    tenantId: 'acme',
    user: { uuid: `u-${code}`, name, userName: name.toLowerCase(), mobileNumber: '0712345678', roles: [] },
    assignments: [{ department: 'ROADS', designation: 'ENGINEER', isCurrentAssignment: true }],
    jurisdictions: [],
  }) as unknown as Employee;

const employeeOptions: EmployeeOptions = {
  departments: [{ code: 'ROADS', name: 'Roads' }],
  designations: [{ code: 'ENGINEER', name: 'Engineer', departments: [] }],
  roles: [],
  boundaries: [],
  mobilePattern: /^\d{10}$/,
};

/** A promise the test settles by hand, to hold a load in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let client: QueryClient;
const renderStep = (step: ReactElement) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{step}</MemoryRouter>
    </QueryClientProvider>,
  );
const placeholder = () => document.querySelector('[aria-busy="true"]');

/** Departments loads Roads and Engineer; `departments` swaps in what a later load returns. */
function stubMasters(departments: () => Promise<MdmsRecord[]> = async () => [record('ROADS', 'Roads')]) {
  masters.mockImplementation((_tenant, kind) => (kind === 'department' ? departments() : Promise.resolve([record('ENGINEER', 'Engineer')])));
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient();
  app.state.tenant = 'acme';
  app.state.targetTenant = 'acme';
  vi.mocked(loadMembers).mockResolvedValue(new Map());
});

afterEach(() => client.clear());

describe('Departments', () => {
  it('shows the last load at once on a revisit and refreshes it behind the table', async () => {
    stubMasters();
    const first = renderStep(<DepartmentsStep />);
    expect(placeholder()).not.toBeNull();
    expect(await screen.findByText('Roads')).toBeInTheDocument();
    first.unmount();

    const refresh = deferred<MdmsRecord[]>();
    stubMasters(() => refresh.promise);
    renderStep(<DepartmentsStep />);
    expect(screen.getByText('Roads')).toBeInTheDocument();
    expect(placeholder()).toBeNull();
    expect(masters).toHaveBeenCalledTimes(4);

    await act(async () => refresh.resolve([record('ROADS', 'Roads'), record('WATER', 'Water')]));
    expect(await screen.findByText('Water')).toBeInTheDocument();
  });

  it('reloads the table after a remove', async () => {
    stubMasters(async () => [record('ROADS', 'Roads'), record('WATER', 'Water')]);
    renderStep(<DepartmentsStep />);
    expect(await screen.findByText('Water')).toBeInTheDocument();

    vi.mocked(removeMaster).mockResolvedValue(undefined);
    stubMasters();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Water' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByText('Water')).not.toBeInTheDocument());
    expect(screen.getByText('Roads')).toBeInTheDocument();
    expect(removeMaster).toHaveBeenCalledWith(expect.objectContaining({ uniqueIdentifier: 'WATER' }));
  });

  it('never shows another workspace’s departments', async () => {
    stubMasters();
    const first = renderStep(<DepartmentsStep />);
    expect(await screen.findByText('Roads')).toBeInTheDocument();
    first.unmount();

    app.state.tenant = 'other';
    app.state.targetTenant = 'other';
    stubMasters(() => new Promise(() => {}));
    renderStep(<DepartmentsStep />);
    expect(screen.queryByText('Roads')).not.toBeInTheDocument();
    expect(placeholder()).not.toBeNull();
  });

  it('keeps the table when a refresh fails, says it may be out of date, and Try again refreshes it', async () => {
    stubMasters();
    const first = renderStep(<DepartmentsStep />);
    expect(await screen.findByText('Roads')).toBeInTheDocument();
    first.unmount();

    stubMasters(async () => {
      throw new Error('Gateway timeout');
    });
    renderStep(<DepartmentsStep />);
    expect(await screen.findByText(/Couldn’t refresh this list/)).toBeInTheDocument();
    expect(screen.getByText('Roads')).toBeInTheDocument();

    stubMasters(async () => [record('ROADS', 'Roads'), record('WATER', 'Water')]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Water')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn’t refresh this list/)).not.toBeInTheDocument();
  });

  it('refreshes what Employees loaded after a change here, though Employees is not on screen', async () => {
    options.mockResolvedValue({ ...employeeOptions, departments: [] });
    employees.mockResolvedValue({ active: [], codes: [] });
    const employeesStep = renderStep(<EmployeesStep />);
    expect(await screen.findByText('You will have to create a department first')).toBeInTheDocument();
    employeesStep.unmount();
    expect(options).toHaveBeenCalledTimes(1);

    stubMasters(async () => [record('ROADS', 'Roads'), record('WATER', 'Water')]);
    renderStep(<DepartmentsStep />);
    expect(await screen.findByText('Water')).toBeInTheDocument();
    vi.mocked(removeMaster).mockResolvedValue(undefined);
    stubMasters();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Water' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(options).toHaveBeenCalledTimes(2));
  });

  it('says when the first load fails, and Try again loads it', async () => {
    stubMasters(async () => {
      throw new Error('Gateway timeout');
    });
    renderStep(<DepartmentsStep />);
    expect(await screen.findByText(/Couldn’t load your departments\. Gateway timeout/)).toBeInTheDocument();

    stubMasters();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Roads')).toBeInTheDocument();
  });
});

describe('Employees', () => {
  it('shows the last load at once on a revisit and refreshes it behind the table', async () => {
    options.mockResolvedValue(employeeOptions);
    employees.mockResolvedValue({ active: [employee('EMP_0001', 'Wanjiru Kamau')], codes: ['EMP_0001'] });
    const first = renderStep(<EmployeesStep />);
    expect(placeholder()).not.toBeNull();
    expect(await screen.findByText('Wanjiru Kamau')).toBeInTheDocument();
    first.unmount();

    const refresh = deferred<EmployeeList>();
    employees.mockReturnValue(refresh.promise);
    renderStep(<EmployeesStep />);
    expect(screen.getByText('Wanjiru Kamau')).toBeInTheDocument();
    expect(placeholder()).toBeNull();

    await act(async () =>
      refresh.resolve({ active: [employee('EMP_0001', 'Wanjiru Kamau'), employee('EMP_0002', 'Otieno Odhiambo')], codes: ['EMP_0001', 'EMP_0002'] }),
    );
    expect(await screen.findByText('Otieno Odhiambo')).toBeInTheDocument();
  });

  it('holds the placeholder, not "create a department first", while options cached without one are refetched', async () => {
    options.mockResolvedValue({ ...employeeOptions, departments: [] });
    employees.mockResolvedValue({ active: [], codes: [] });
    const first = renderStep(<EmployeesStep />);
    expect(await screen.findByText('You will have to create a department first')).toBeInTheDocument();
    first.unmount();

    const refresh = deferred<EmployeeOptions>();
    options.mockReturnValue(refresh.promise);
    renderStep(<EmployeesStep />);
    expect(placeholder()).not.toBeNull();
    expect(screen.queryByText('You will have to create a department first')).not.toBeInTheDocument();

    await act(async () => refresh.resolve({ ...employeeOptions, boundaries: [{ code: 'W1', name: 'Ward 1', boundaryType: 'Ward' }] } as EmployeeOptions));
    expect(await screen.findByText('No employees yet')).toBeInTheDocument();
  });

  it('reloads the employee list and invite states after a remove, not the options', async () => {
    options.mockResolvedValue(employeeOptions);
    employees.mockResolvedValue({ active: [employee('EMP_0001', 'Wanjiru Kamau'), employee('EMP_0002', 'Otieno Odhiambo')], codes: ['EMP_0001', 'EMP_0002'] });
    renderStep(<EmployeesStep />);
    expect(await screen.findByText('Otieno Odhiambo')).toBeInTheDocument();
    expect(options).toHaveBeenCalledTimes(1);
    const membersBefore = vi.mocked(loadMembers).mock.calls.length;

    vi.mocked(removeEmployee).mockResolvedValue(undefined);
    employees.mockResolvedValue({ active: [employee('EMP_0001', 'Wanjiru Kamau')], codes: ['EMP_0001', 'EMP_0002'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Otieno Odhiambo' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getAllByRole('button').find((b) => /delete|remove/i.test(b.textContent ?? '') && !/cancel/i.test(b.textContent ?? ''))!);

    await waitFor(() => expect(screen.queryByText('Otieno Odhiambo')).not.toBeInTheDocument());
    expect(vi.mocked(loadMembers).mock.calls.length).toBeGreaterThan(membersBefore);
    expect(options).toHaveBeenCalledTimes(1);
  });

  it('keeps the table when a refresh fails and offers Try again', async () => {
    options.mockResolvedValue(employeeOptions);
    employees.mockResolvedValue({ active: [employee('EMP_0001', 'Wanjiru Kamau')], codes: ['EMP_0001'] });
    const first = renderStep(<EmployeesStep />);
    expect(await screen.findByText('Wanjiru Kamau')).toBeInTheDocument();
    first.unmount();

    employees.mockRejectedValue(new Error('Gateway timeout'));
    renderStep(<EmployeesStep />);
    expect(await screen.findByText(/Couldn’t refresh this list/)).toBeInTheDocument();
    expect(screen.getByText('Wanjiru Kamau')).toBeInTheDocument();
  });
});
