import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
import { useListContext } from 'ra-core';
import { Download, Upload, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { triggerDownload } from '@/admin/bulk/BulkImportPanel';
import { localizationService } from '@/api';
import { useApp } from '../../App';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';

/** Two-button toolbar for the Localization list:
 *  - Export downloads ALL messages for the two locales currently selected in
 *    the pivot view (LocalizationList's locale dropdowns) as a flat .xlsx
 *    with `code, module, locale, message` rows — same shape the bulk-import
 *    page accepts so the round-trip is symmetric.
 *  - Import navigates to /manage/localization/bulk.
 *
 *  We don't reuse `BulkExportButton` because the pivot list's data is
 *  per-row (one row per code with two message columns), not what we want
 *  for round-trip — we want one row per (code, locale) so users can edit
 *  in Excel and re-upload without reshaping. */
export function LocalizationToolbar() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const { filterValues } = useListContext();
  const { locales, isLoading } = useAvailableLocales();

  const fallbackA = locales[0]?.value ?? 'en_IN';
  const fallbackB = locales[1]?.value ?? locales[0]?.value ?? 'en_IN';
  const localeA = String(filterValues.locale || fallbackA);
  const localeB = String(filterValues.locale2 || fallbackB);

  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // De-dupe — selecting the same locale on both sides shouldn't double-fetch.
      const distinctLocales = Array.from(new Set([localeA, localeB]));
      const all = await Promise.all(
        distinctLocales.map((loc) => localizationService.searchMessages(tenantId, loc)),
      );
      const flat = all.flat();
      // Sort by (locale, module, code) so diffs across exports are clean.
      flat.sort((a, b) =>
        a.locale.localeCompare(b.locale) ||
        a.module.localeCompare(b.module) ||
        a.code.localeCompare(b.code),
      );

      const header = ['code', 'module', 'locale', 'message'];
      const rows = flat.map((m) => [m.code, m.module, m.locale, m.message]);
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
      ws['!cols'] = [{ wch: 36 }, { wch: 22 }, { wch: 10 }, { wch: 80 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Localization');
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fname = `localization-${tenantId}-${distinctLocales.join('-')}.xlsx`;
      triggerDownload(blob, fname);
    } finally {
      setExporting(false);
    }
  }, [tenantId, localeA, localeB]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={exporting || isLoading}
        className="gap-1.5"
      >
        {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {exporting ? 'Exporting…' : 'Export'}
      </Button>
      <Button asChild variant="outline" size="sm" className="gap-1.5">
        <Link to="/manage/localization/bulk">
          <Upload className="w-4 h-4" />
          Bulk import
        </Link>
      </Button>
    </>
  );
}
