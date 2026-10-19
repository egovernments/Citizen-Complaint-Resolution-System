import type { ReactElement } from "react";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import type { I18n } from "./i18n";
import type { DigitTemplateProps } from "./Template";

/**
 * `PageProps` with the theme's own Template type.
 *
 * Keycloakify types `Template` as accepting only the stock props, so a page
 * that passes `eyebrow`/`lede`/`messageTitle` would not typecheck against it.
 * Narrowing the type here keeps those props checked instead of casting them
 * away at every call site.
 */
export type DigitPageProps<NarrowedKcContext> = Omit<
    PageProps<NarrowedKcContext, I18n>,
    "Template"
> & {
    Template: (props: DigitTemplateProps) => ReactElement | null;
};
