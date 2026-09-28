/** Types for the palette generator, which is plain ESM so it can run via `node`. */
export declare const PRESET_NAME: string;
export declare const THEMES_MODULE: string;
export declare const OUTPUT_FILE: string;
export declare function readConfiguratorTokens(): Promise<Record<string, string>>;
export declare function renderTokensCss(variables: Record<string, string>): string;
export declare function generate(): Promise<string>;
