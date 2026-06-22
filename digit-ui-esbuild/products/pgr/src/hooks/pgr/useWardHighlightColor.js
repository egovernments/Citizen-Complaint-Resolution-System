import useMapConfig, { DEFAULT_WARD_HIGHLIGHT_COLOR } from "./useMapConfig";

export { DEFAULT_WARD_HIGHLIGHT_COLOR };

// Back-compat wrapper. Map theming (tile theme + ward highlight) now lives in
// useMapConfig, which reads the whole `RAINMAKER-PGR.MapConfig` master. Existing
// callers that only need the ward-highlight colour keep working unchanged.
const useWardHighlightColor = () => useMapConfig().wardHighlightColor;

export default useWardHighlightColor;
