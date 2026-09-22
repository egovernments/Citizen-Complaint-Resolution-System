import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KcPage } from "./kc.gen";

// The login theme is only ever rendered by Keycloak, which injects `kcContext`
// before this bundle runs. In the Vite dev server there is no Keycloak, so
// `npm run dev` is driven by the mock context (see src/dev.tsx usage in the
// README) rather than by this entrypoint alone.
createRoot(document.getElementById("root")!).render(
    <StrictMode>
        {window.kcContext === undefined ? (
            <h1>No Keycloak context</h1>
        ) : (
            <KcPage kcContext={window.kcContext} />
        )}
    </StrictMode>
);
