import { useMemo } from "react";

// Default = the legacy hardcoded ward-highlight orange. Anything without
// an MDMS MapConfig record keeps the exact original behaviour.
export const DEFAULT_WARD_HIGHLIGHT_COLOR = "#FFA74F";

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Resolves the complaint-location map's ward-highlight colour from MDMS so
// it can be themed per tenant without a code change. Reads
// `RAINMAKER-PGR.MapConfig[0].wardHighlightColor`; falls back to the
// legacy orange while loading, when the master is absent, on error, or
// when the value isn't a valid hex.
//
// FOLLOW-UP: expose `wardHighlightColor` (and likely the broader map
// theming) as a field in the DIGIT Studio configurator so operators can
// set it from the UI instead of seeding MDMS by hand. Tracked as a
// digit-ui-esbuild issue (see PR description).
const useWardHighlightColor = () => {
  const tenantId =
    Digit?.SessionStorage?.get?.("CITIZEN.COMMON.HOME.CITY")?.code ||
    Digit?.ULBService?.getCurrentTenantId?.();

  const { data } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "MapConfig" }],
    {
      cacheTime: Infinity,
      // MDMS errors (master not registered for this tenant) must not
      // break the map — swallow and fall through to the default.
      retry: false,
      enabled: !!tenantId,
      select: (d) => d?.["RAINMAKER-PGR"]?.MapConfig,
    },
    { schemaCode: "RAINMAKER-PGR.MapConfig" }
  );

  return useMemo(() => {
    const c = Array.isArray(data) ? data[0]?.wardHighlightColor : undefined;
    return typeof c === "string" && HEX.test(c.trim())
      ? c.trim()
      : DEFAULT_WARD_HIGHLIGHT_COLOR;
  }, [data]);
};

export default useWardHighlightColor;
