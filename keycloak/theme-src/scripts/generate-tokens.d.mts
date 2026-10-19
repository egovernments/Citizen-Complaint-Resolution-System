/** Types for the palette generator, which is plain ESM so it can run via `node`. */
export interface ConfiguratorTheme {
    name: string;
    variables: Record<string, string>;
}
export declare const DEFAULT_PRESET: string;
export declare const THEMES_MODULE: string;
export declare const OUTPUT_FILE: string;
export declare const CHOICE_FILE: string;
export declare function readConfiguratorThemes(): Promise<{ themes: ConfiguratorTheme[]; storageKey: string }>;
export declare function renderTokensCss(themes: ConfiguratorTheme[]): string;
export declare function renderChoiceModule(input: { themes: ConfiguratorTheme[]; storageKey: string }): string;
export declare function generate(): Promise<{ css: string; choice: string }>;
