/**
 * Dev-server entrypoint, served at `/dev.html`. Keycloak is not in the loop
 * here, so the page is chosen from the query string:
 * `/dev.html?page=login.ftl&state=invalid-credentials`. The screenshot suite
 * drives the same URLs, which is what makes the baselines reproducible.
 *
 * This file is not part of the theme bundle: `index.html` is the only build
 * entrypoint, and it loads `main.tsx`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { KcPage } from "./kc.gen";
import { getKcContextMock } from "./login/KcContextMock";
import { withFieldErrors } from "./login/mockStates";

const params = new URLSearchParams(window.location.search);
const pageId = (params.get("page") ?? "login.ftl") as Parameters<
    typeof getKcContextMock
>[0]["pageId"];

const kcContext = (() => {
    const base = getKcContextMock({ pageId });
    switch (params.get("state")) {
        case "invalid-credentials":
            return withFieldErrors(base, {
                username: "Invalid username or password.",
                password: "Invalid username or password."
            });
        case "password-mismatch":
            return withFieldErrors(base, {
                "password-confirm": "Passwords don't match."
            });
        default:
            return base;
    }
})();

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <KcPage kcContext={kcContext} />
    </StrictMode>
);
