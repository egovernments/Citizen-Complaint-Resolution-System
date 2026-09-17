import { CustomSVG } from "../atoms/CustomSVG";

/**
 * MDMS stores menu icons in a Material-ish "group:token" form
 * ("action:dashboard", "places:business-center", "content:add") while the
 * icon registries export PascalCase components ("Dashboard", "Add"). Nothing
 * translated between the two, so every row configured that way resolved to
 * null — which is why a sidebar of distinct modules could come out wearing
 * one generic fallback glyph.
 *
 * Drop the group prefix and PascalCase the token. Names that are already
 * component names ("Home", "PGRIcon") pass through unchanged.
 */
const normalizeIconName = (name) => {
  if (typeof name !== "string" || name === "") return name;
  const token = name.includes(":") ? name.slice(name.indexOf(":") + 1) : name;
  if (token === "") return name;
  return token
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
};

export const iconRender = (iconReq, iconFill, width, height, className) => {
  try {
    const components = require("@egovernments/digit-ui-svg-components");
    // Exact name still wins, so nothing that resolves today can change.
    const normalized = normalizeIconName(iconReq);
    const DynamicIcon = components?.[iconReq] || components?.[normalized];
    const svgIcon = CustomSVG?.[iconReq] || CustomSVG?.[normalized];

    if (DynamicIcon) {
      const svgElement = DynamicIcon({
        width: width,
        height: height,
        fill: iconFill,
        className: className,
      });
      return svgElement;
    } else if (svgIcon) {
      const svgElement = svgIcon({
        width: width,
        height: height,
        fill: iconFill,
        className: className,
      });
      return svgElement;
    } else {
      console.warn(`Icon not found, ${iconReq}`);
      return null;
    }
  } catch (error) {
    console.warn(`Icon not found, ${iconReq}`);
    return null;
  }
};
