import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildEmployeeTemplate, employeeTemplateFilename } from './templateBuilder';

async function read(blob: Blob): Promise<XLSX.WorkBook> {
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as ArrayBuffer);
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(blob);
  });
  return XLSX.read(buf, { type: 'array' });
}

describe('buildEmployeeTemplate', () => {
  const depts = [{ code: 'DEPT_A', name: 'Alpha' }, { code: 'DEPT_B', name: 'Beta' }];
  const desigs = [{ code: 'DESIG_X', name: 'Officer X' }];
  const roles = [{ code: 'EMPLOYEE' }, { code: 'GRO' }, { code: 'PGR_LME' }];
  const boundaries = [
    { code: 'COUNTY_ROOT', boundaryType: 'County' },
    { code: 'ZONE_2', boundaryType: 'Zone', parent: 'COUNTY_ROOT' },
    { code: 'WARD_REAL', boundaryType: 'Ward', parent: 'ZONE_2' },
  ];

  it('lists the passed-in codes in the Codes sheet and has an Instructions sheet', async () => {
    const wb = await read(buildEmployeeTemplate('ke.test', depts, desigs, boundaries, roles));
    expect(wb.SheetNames).toEqual(['Employee', 'Codes', 'Instructions']);
    const codes = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Codes, { header: 1 }).flat().join('|');
    for (const c of ['DEPT_A : Alpha', 'DEPT_B : Beta', 'DESIG_X : Officer X', 'GRO', 'PGR_LME', 'WARD_REAL : Ward', 'ZONE_2 : Zone']) {
      expect(codes).toContain(c);
    }
  });

  it('builds the sample row from real codes, not hard-coded placeholders', async () => {
    const wb = await read(buildEmployeeTemplate('ke.test', depts, desigs, boundaries, roles));
    const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Employee);
    expect(row.department).toBe('DEPT_A');
    expect(row.designation).toBe('DESIG_X');
    expect(row.roles).toBe('EMPLOYEE,PGR_LME');
    expect(row.jurisdictions).toBe('WARD_REAL');
    expect(row.mobileNumber ?? '').toBe('');
    expect(JSON.stringify(row)).not.toMatch(/WARD_001|COUNTY_001|DEPT_07|NAIROBI/);
  });

  it('leaves reference cells blank when the workspace has no data', async () => {
    const wb = await read(buildEmployeeTemplate('ke.test', [], [], [], []));
    const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Employee);
    expect(row.department ?? '').toBe('');
    expect(row.jurisdictions ?? '').toBe('');
  });

  it('drops founder records and platform roles from the lists and the sample', async () => {
    const wb = await read(
      buildEmployeeTemplate(
        'ke.test',
        [{ code: 'ONBOARDING_ADMIN', name: 'Admin' }, ...depts],
        [{ code: 'ONBOARDING_FOUNDER', name: 'Founder' }, ...desigs],
        [{ code: 'WS_ROOT', boundaryType: 'Root', hierarchyType: 'WORKSPACE' }, ...boundaries],
        [{ code: 'SUPERUSER' }, { code: 'MDMS_ADMIN' }, ...roles],
      ),
    );
    const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Employee);
    expect(row.department).toBe('DEPT_A');
    expect(row.designation).toBe('DESIG_X');
    expect(row.roles).toBe('EMPLOYEE,PGR_LME');
    expect(row.jurisdictions).toBe('WARD_REAL');
    const codes = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Codes, { header: 1 }).flat().join('|');
    expect(codes).not.toMatch(/ONBOARDING_|SUPERUSER|MDMS_ADMIN|WS_ROOT/);
  });

  it('falls back to EMPLOYEE alone without other roles, and asks for one department per row', async () => {
    const wb = await read(buildEmployeeTemplate('ke.test', depts, desigs, boundaries, []));
    const [row] = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets.Employee);
    expect(row.roles).toBe('EMPLOYEE');
    const text = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Instructions, { header: 1 }).flat().join('\n');
    expect(text).toContain('ONE department code');
  });

  it('translates the Instructions and Codes headers through the passed translator', async () => {
    const wb = await read(buildEmployeeTemplate('ke.test', depts, desigs, boundaries, roles, (_k, en) => `T:${en}`));
    const text = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Instructions, { header: 1 }).flat().join('\n');
    expect(text).toContain('T:Employee bulk import template');
    expect(XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Codes, { header: 1 })[0][0]).toBe('T:departments (code : name)');
  });

  it('names the workbook the same way everywhere', () => {
    expect(employeeTemplateFilename('ke.test')).toBe('Employee_Master_Dynamic_KE.TEST.xlsx');
  });
});
