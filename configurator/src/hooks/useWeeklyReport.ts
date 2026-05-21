import { useState } from 'react';
import * as XLSX from 'xlsx';
import { digitClient } from '@/providers/bridge';
import type { MdmsRecord } from '@digit-mcp/data-provider';

// ---------- Types -----------------------------------------------------------

interface ReportColumn {
  header: string;
  field: string;
  transform?: 'uppercase' | 'lowercase';
}

interface ReportCategory {
  name: string;
  serviceCodes: string[];
}

interface ReportConfig {
  code: string;
  titleTemplate: string;
  sectionTitleTemplate: string;
  countLabelTemplate: string;
  summaryTitle: string;
  columns: ReportColumn[];
  categories: ReportCategory[];
  statusMapping: Record<string, string>;
}

interface ComplaintRow {
  citizenName: string;
  citizenPhone: string;
  categoryName: string;
  complaintType: string;
  resolutionText: string;
  statusDisplay: string;
  serviceCode: string;
  createdDate: Date;
  [key: string]: unknown;
}

// ---------- Defaults --------------------------------------------------------

const DEFAULT_CONFIG: ReportConfig = {
  code: 'default',
  titleTemplate: 'WEEKLY REPORT FROM {startDate} TO {endDate}',
  sectionTitleTemplate: '{category} RESOLUTION OF COMPLAINTS',
  countLabelTemplate: 'COUNT OF {category}',
  summaryTitle: 'TOTAL INQUIRY',
  columns: [
    { header: 'NAME', field: 'citizenName', transform: 'uppercase' },
    { header: 'CONTACT', field: 'citizenPhone' },
    { header: 'ENQUIRY', field: 'categoryName' },
    { header: 'COMPLAINT', field: 'complaintType' },
    { header: 'RESOLUTION', field: 'resolutionText' },
    { header: 'STATUS', field: 'statusDisplay' },
  ],
  categories: [],
  statusMapping: {
    RESOLVED: 'RESOLVED',
    CLOSEDAFTERRESOLUTION: 'RESOLVED',
    PENDINGFORASSIGNMENT: 'PENDING',
    PENDINGATLME: 'IN PROGRESS',
    REJECTED: 'REJECTED',
  },
};

// ---------- Date helpers ----------------------------------------------------

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatDateUpper(d: Date): string {
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function dayLabel(d: Date): string {
  return `${DAYS[d.getDay()]} ${ordinal(d.getDate())} ${MONTHS[d.getMonth()]}`;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Convert an HTML `<input type="week">` value (e.g. "2026-W17") to a Monday Date */
export function weekStringToDate(weekStr: string): Date {
  const [yearStr, weekPart] = weekStr.split('-W');
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekPart, 10);
  // ISO: week 1 contains Jan 4. Monday of that week:
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7; // 1=Mon .. 7=Sun
  const monday1 = new Date(jan4);
  monday1.setDate(jan4.getDate() - dayOfWeek + 1);
  const target = new Date(monday1);
  target.setDate(monday1.getDate() + (week - 1) * 7);
  target.setHours(0, 0, 0, 0);
  return target;
}

/** Get current ISO week string for the `<input type="week">` default value */
export function getCurrentWeekString(): string {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday1 = new Date(jan4);
  monday1.setDate(jan4.getDate() - dayOfWeek + 1);
  const diff = now.getTime() - monday1.getTime();
  const weekNum = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ---------- PGR fetch with auto-pagination ----------------------------------

async function fetchAllComplaints(
  tenantId: string,
  fromDate: number,
  toDate: number,
): Promise<Record<string, unknown>[]> {
  const PAGE = 100;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const wrappers = await digitClient.pgrSearch(tenantId, {
      fromDate,
      toDate,
      limit: PAGE,
      offset,
    });
    all.push(...wrappers);
    if (wrappers.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ---------- Data mapping ----------------------------------------------------

function mapToRow(
  wrapper: Record<string, unknown>,
  config: ReportConfig,
  typeNameMap: Map<string, string>,
): ComplaintRow {
  const service = (wrapper.service || {}) as Record<string, unknown>;
  // citizen is nested inside service, not at wrapper level
  const citizen = (service.citizen || {}) as Record<string, unknown>;
  const workflow = (wrapper.workflow || {}) as Record<string, unknown>;
  const auditDetails = (service.auditDetails || {}) as Record<string, unknown>;

  const serviceCode = (service.serviceCode || '') as string;
  const applicationStatus = ((service.applicationStatus || '') as string).toUpperCase();
  const typeName = typeNameMap.get(serviceCode) || serviceCode;

  return {
    citizenName: ((citizen.name || '') as string),
    citizenPhone: ((citizen.mobileNumber || '') as string),
    categoryName: typeName,
    complaintType: typeName,
    resolutionText: ((workflow.comments || service.description || '') as string),
    statusDisplay: config.statusMapping[applicationStatus] || applicationStatus,
    serviceCode,
    createdDate: new Date((auditDetails.createdTime || Date.now()) as number),
  };
}

function getCategoryName(
  serviceCode: string,
  config: ReportConfig,
  typeNameMap: Map<string, string>,
): string {
  // If config has explicit category mappings, use those
  if (config.categories.length > 0) {
    const cat = config.categories.find((c) =>
      c.serviceCodes.includes(serviceCode),
    );
    if (cat) return cat.name;
  }
  // Fall back to display name from MDMS
  return typeNameMap.get(serviceCode) || serviceCode;
}

// ---------- Grouping --------------------------------------------------------

type CategoryGroup = Map<string, ComplaintRow[]>;
type DayGroup = Map<string, CategoryGroup>;

function groupByDayAndCategory(
  rows: ComplaintRow[],
  config: ReportConfig,
  typeNameMap: Map<string, string>,
): DayGroup {
  const grouped: DayGroup = new Map();

  for (const row of rows) {
    const dk = dateKey(row.createdDate);
    const dl = dayLabel(row.createdDate);
    const key = `${dk}|${dl}`;

    if (!grouped.has(key)) grouped.set(key, new Map());
    const dayMap = grouped.get(key)!;

    const catName = getCategoryName(row.serviceCode, config, typeNameMap);
    if (!dayMap.has(catName)) dayMap.set(catName, []);
    dayMap.get(catName)!.push(row);
  }

  // Sort by date key
  return new Map(
    [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)),
  );
}

// ---------- XLSX sheet builder -----------------------------------------------

function getFieldValue(row: ComplaintRow, col: ReportColumn): string {
  const val = String(row[col.field] ?? '');
  if (col.transform === 'uppercase') return val.toUpperCase();
  if (col.transform === 'lowercase') return val.toLowerCase();
  return val;
}

function buildSheetData(
  categories: CategoryGroup,
  config: ReportConfig,
  weekStart: Date,
  weekEnd: Date,
): unknown[][] {
  const sheet: unknown[][] = [];
  const colCount = config.columns.length;

  // Row 1: Title
  const title = config.titleTemplate
    .replace('{startDate}', formatDateUpper(weekStart))
    .replace('{endDate}', formatDateUpper(weekEnd));
  sheet.push([title, ...new Array(colCount - 1).fill('')]);
  sheet.push([]); // blank row

  const categoryCounts: [string, number][] = [];

  for (const [catName, rows] of categories) {
    // Section header
    const sectionTitle = config.sectionTitleTemplate.replace('{category}', catName.toUpperCase());
    sheet.push([sectionTitle, ...new Array(colCount - 1).fill('')]);

    // Column headers
    sheet.push(config.columns.map((c) => c.header));

    // Data rows
    for (const row of rows) {
      sheet.push(config.columns.map((col) => getFieldValue(row, col)));
    }

    // Count row
    const countLabel = config.countLabelTemplate.replace('{category}', catName.toUpperCase());
    const countRow: unknown[] = [countLabel];
    countRow[colCount - 1] = rows.length;
    while (countRow.length < colCount) countRow.splice(1, 0, '');
    sheet.push(countRow);

    sheet.push([]); // blank row

    categoryCounts.push([catName.toUpperCase(), rows.length]);
  }

  // Summary section
  sheet.push([config.summaryTitle, ...new Array(colCount - 1).fill('')]);

  let total = 0;
  for (const [catName, count] of categoryCounts) {
    const summaryRow: unknown[] = [catName];
    summaryRow[1] = count;
    sheet.push(summaryRow);
    total += count;
  }

  const totalRow: unknown[] = ['TOTAL'];
  totalRow[1] = total;
  sheet.push(totalRow);

  return sheet;
}

// ---------- Exported hook ----------------------------------------------------

export function useWeeklyReport() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (weekStart: Date) => {
    setIsGenerating(true);
    setError(null);
    try {
      const stateTenant = digitClient.stateTenantId;
      if (!stateTenant) throw new Error('Not logged in');

      // 1. Determine city tenants — search MDMS and collect all city-level ones
      const tenantRecords = await digitClient.mdmsSearch(stateTenant, 'tenant.tenants');
      const cityTenants = tenantRecords
        .map((r: MdmsRecord) => (r.data as Record<string, unknown>).code as string)
        .filter((code: string) => code && code.includes('.'));

      // 2. Load report config from MDMS (use defaults if not seeded yet)
      let config: ReportConfig = { ...DEFAULT_CONFIG };
      try {
        const configRecords = await digitClient.mdmsSearch(
          stateTenant,
          'RAINMAKER-PGR.WeeklyReportConfig',
        );
        if (configRecords.length > 0) {
          config = { ...DEFAULT_CONFIG, ...(configRecords[0].data as ReportConfig) };
        }
      } catch {
        // Schema may not exist yet — use defaults
      }

      // 3. Load complaint type display names
      const typeRecords = await digitClient.mdmsSearch(stateTenant, 'RAINMAKER-PGR.ServiceDefs');
      const typeNameMap = new Map<string, string>();
      for (const r of typeRecords) {
        const d = r.data as Record<string, unknown>;
        typeNameMap.set(d.serviceCode as string, (d.name || d.serviceName || d.serviceCode) as string);
      }

      // 4. Calculate week end (Friday end-of-day for a Mon-Fri week, or Sun for full week)
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      // 5. Fetch complaints for the date range across all city tenants
      const tenantsToSearch = cityTenants.length > 0 ? cityTenants : [stateTenant];
      const allWrappers: Record<string, unknown>[] = [];
      for (const t of tenantsToSearch) {
        const wrappers = await fetchAllComplaints(t, weekStart.getTime(), weekEnd.getTime());
        allWrappers.push(...wrappers);
      }

      if (allWrappers.length === 0) {
        throw new Error('No complaints found for the selected week.');
      }

      // 6. Map to rows
      const rows = allWrappers.map((w) => mapToRow(w, config, typeNameMap));

      // 7. Group by day → category
      const grouped = groupByDayAndCategory(rows, config, typeNameMap);

      // 8. Build XLSX workbook
      const wb = XLSX.utils.book_new();

      for (const [dayKey, categories] of grouped) {
        const [, dl] = dayKey.split('|');
        const sheetName = dl.slice(0, 31); // Excel sheet name max 31 chars
        const sheetData = buildSheetData(categories, config, weekStart, weekEnd);
        const ws = XLSX.utils.aoa_to_sheet(sheetData);

        // Set column widths
        ws['!cols'] = config.columns.map(() => ({ wch: 25 }));

        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }

      // 9. Download
      const startStr = `${weekStart.getDate()}-${MONTHS[weekStart.getMonth()].slice(0, 3)}`;
      const endStr = `${weekEnd.getDate()}-${MONTHS[weekEnd.getMonth()].slice(0, 3)}-${weekEnd.getFullYear()}`;
      XLSX.writeFile(wb, `Weekly-Report-${startStr}-to-${endStr}.xlsx`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    } finally {
      setIsGenerating(false);
    }
  };

  return { generate, isGenerating, error };
}
