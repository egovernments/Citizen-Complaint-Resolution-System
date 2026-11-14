/**
 * Write the dashboard export (export/exportModel.js) as an .xlsx (#1977).
 *
 * ExcelJS (~1 MB) is loaded only when someone exports: the build copies its
 * browser bundle to /digit-ui/vendor/exceljs.min.js (esbuild.build.js) and
 * this file adds a <script> for it on first use. The esbuild build has no
 * code splitting, so a dynamic import() would have inlined it into every page.
 */

export const EXCELJS_SRC = "/digit-ui/vendor/exceljs.min.js";

let excelJsPromise = null;

/** Load window.ExcelJS once; a failed load can be retried on the next export. */
export function loadExcelJs() {
  if (typeof window !== "undefined" && window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelJsPromise) {
    excelJsPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = EXCELJS_SRC;
      script.async = true;
      script.onload = () =>
        window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error(`${EXCELJS_SRC} did not define ExcelJS`));
      script.onerror = () => reject(new Error(`Could not load ${EXCELJS_SRC}`));
      document.head.appendChild(script);
    }).catch((err) => {
      excelJsPromise = null;
      throw err;
    });
  }
  return excelJsPromise;
}

const MAX_COLUMN_WIDTH = 60;

/** Build the workbook. `ExcelJS` is the library (window.ExcelJS, or require("exceljs") in tests). */
export function buildWorkbook(ExcelJS, model) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DIGIT dashboard";
  for (const sheet of model.sheets) writeSheet(workbook.addWorksheet(sheet.name), sheet);
  return workbook;
}

function writeSheet(ws, sheet) {
  const widths = [];
  const track = (col, text) => {
    widths[col] = Math.max(widths[col] || 8, Math.min(MAX_COLUMN_WIDTH, String(text ?? "").length + 2));
  };

  ws.addRow([sheet.title]).font = { bold: true, size: 14 };
  if (sheet.subtitle) ws.addRow([sheet.subtitle]).font = { italic: true };
  for (const [label, value] of sheet.info) {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    track(0, label);
  }
  for (const note of sheet.notes || []) ws.addRow([note]).font = { italic: true };
  ws.addRow([]);

  if (sheet.message) {
    ws.addRow([sheet.message]);
    track(0, sheet.message);
  } else {
    const header = ws.addRow(sheet.columns);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
      cell.border = { bottom: { style: "thin" } };
    });
    sheet.columns.forEach((label, i) => track(i, label));
    ws.views = [{ state: "frozen", ySplit: header.number }];

    for (const cells of sheet.rows) {
      const row = ws.addRow(cells.map(cellValue));
      cells.forEach((cell, i) => {
        if (cell.numFmt) row.getCell(i + 1).numFmt = cell.numFmt;
        if (cell.sheet) row.getCell(i + 1).font = { color: { argb: "FF0563C1" }, underline: true };
        track(i, cell.text);
      });
    }
  }
  widths.forEach((width, i) => {
    if (width) ws.getColumn(i + 1).width = width;
  });
}

function cellValue(cell) {
  if (cell.sheet) return { text: cell.text, hyperlink: `#'${cell.sheet.replace(/'/g, "''")}'!A1` };
  if (typeof cell.value === "number") return cell.value;
  return cell.text;
}

/** Build the file and hand it to the browser as a download. */
export async function downloadDashboardExport(model) {
  const ExcelJS = await loadExcelJs();
  const buffer = await buildWorkbook(ExcelJS, model).xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = model.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right after click() can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
