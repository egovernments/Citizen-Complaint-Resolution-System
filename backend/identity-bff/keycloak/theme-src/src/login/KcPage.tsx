import { Suspense, lazy } from "react";
import type { KcContext } from "./KcContext";

/**
 * One jar carries three login themes; Keycloak tells the bundle which one a
 * client selected through `kcContext.themeName`. Each implementation is its
 * own lazy chunk, so a theme's stylesheet is only loaded for that theme and
 * none of them can restyle another.
 *
 * - configurator-blue — the Configurator's sign-in (ConfiguratorKcPage.tsx).
 * - digit-employee / digit-citizen — the legacy digit-ui employee and citizen
 *   login pages, branded per tenant (src/digit, #2167).
 */
const ConfiguratorKcPage = lazy(() => import("./ConfiguratorKcPage"));
const DigitEmployeeKcPage = lazy(() => import("../digit/employee/EmployeeKcPage"));
const DigitCitizenKcPage = lazy(() => import("../digit/citizen/CitizenKcPage"));

export default function KcPage(props: { kcContext: KcContext }) {
    const { kcContext } = props;
    return (
        <Suspense>
            {(() => {
                switch (kcContext.themeName) {
                    case "digit-employee":
                        return <DigitEmployeeKcPage kcContext={kcContext} />;
                    case "digit-citizen":
                        return <DigitCitizenKcPage kcContext={kcContext} />;
                    default:
                        return <ConfiguratorKcPage kcContext={kcContext} />;
                }
            })()}
        </Suspense>
    );
}
