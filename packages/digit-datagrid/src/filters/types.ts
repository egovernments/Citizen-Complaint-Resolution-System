/**
 * Common props shared by all filter input elements.
 * Provides type-safe `.props` access on filter elements in React 19
 * where `ReactElement.props` is typed as `unknown`.
 */
export interface FilterElementProps {
  source: string;
  alwaysOn?: boolean;
  label?: string;
  defaultValue?: unknown;
  /** Allow access to component-specific props (choices, reference, etc.) */
  [key: string]: unknown;
}

/** A typed filter React element with accessible .props */
export type FilterElement = React.ReactElement<FilterElementProps>;
