const TABLE_KINDS = new Set(['table', 'data-table']);
const FILTER_OPERATORS = ['eq', 'gte', 'gt', 'lte', 'lt'];
const LEGACY_TABLE_KEYS = ['tableProfile', 'needsPrior', 'minCount'];

function outputColumns(definition) {
  const query = definition.query || {};
  return new Set([
    ...(query.dimensions || []),
    ...(query.measures || []).map((measure) => measure?.name).filter(Boolean),
  ]);
}

function validateTable(definition, errors) {
  const { id, viz = {}, query } = definition;
  for (const key of LEGACY_TABLE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(viz, key)) {
      errors.push(`${id}: viz.${key} is not part of the dashboard table contract`);
    }
  }

  if (!TABLE_KINDS.has(viz.kind) || !query) return;

  const available = outputColumns(definition);
  const derived = new Set();
  const comparison = viz.comparison;
  if (comparison) {
    if (comparison.period !== 'prior' || comparison.mode !== 'percentChange') {
      errors.push(`${id}: comparison must use prior/percentChange`);
    }
    if (!Array.isArray(comparison.joinBy) || comparison.joinBy.length === 0) {
      errors.push(`${id}: comparison.joinBy must contain at least one dimension`);
    } else {
      for (const dimension of query.dimensions || []) {
        if (!comparison.joinBy.includes(dimension)) {
          errors.push(`${id}: comparison.joinBy must include query dimension ${dimension}`);
        }
      }
      for (const key of comparison.joinBy) {
        if (!(query.dimensions || []).includes(key)) {
          errors.push(`${id}: comparison join key ${key} is not a query dimension`);
        }
      }
    }
    if (!available.has(comparison.valueKey)) {
      errors.push(`${id}: comparison valueKey ${comparison.valueKey} is not a query output`);
    }
    if (!comparison.outputKey || available.has(comparison.outputKey)) {
      errors.push(`${id}: comparison.outputKey must name a new derived column`);
    } else {
      derived.add(comparison.outputKey);
    }
  }

  const columns = viz.columns || [];
  for (const column of columns) {
    if (!available.has(column?.id) && !derived.has(column?.id)) {
      errors.push(`${id}: table column ${column?.id} is not produced by its query or comparison`);
    }
  }

  if (viz.valueKey && !available.has(viz.valueKey)) {
    errors.push(`${id}: viz.valueKey ${viz.valueKey} is not produced by its query`);
  }

  const rowFilter = viz.rowFilter;
  if (rowFilter) {
    if (!available.has(rowFilter.column) && !derived.has(rowFilter.column)) {
      errors.push(`${id}: rowFilter column ${rowFilter.column} is not available`);
    }
    const operators = FILTER_OPERATORS.filter((operator) =>
      Object.prototype.hasOwnProperty.call(rowFilter, operator)
    );
    if (operators.length !== 1) {
      errors.push(`${id}: rowFilter must declare exactly one supported operator`);
    }
  }

  for (const measure of query.measures || []) {
    if (measure?.window || measure?.numerator?.window || measure?.denominator?.window) {
      errors.push(`${id}: measure-level windows are unsupported; use the query window contract`);
    }
  }
}

export function dashboardCatalogContractErrors(definitions) {
  const errors = [];
  const seen = new Set();
  for (const definition of definitions || []) {
    const id = definition?.id;
    if (!id || typeof id !== 'string') {
      errors.push('every KpiDefinition record must carry a string id');
      continue;
    }
    if (seen.has(id)) errors.push(`${id}: duplicate KPI id`);
    seen.add(id);
    validateTable(definition, errors);
  }
  return errors;
}

export function assertDashboardCatalogContract(definitions) {
  const errors = dashboardCatalogContractErrors(definitions);
  if (errors.length) {
    throw new Error(`Dashboard catalog contract failed:\n- ${errors.join('\n- ')}`);
  }
}
