import React, { useState, useEffect,Fragment } from "react";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { SVG, TextInput } from "../atoms";
import { IMAGES } from "../constants/images/images";
import { Colors } from "../constants/colors/colorconstants";
import { iconRender } from "../utils/iconRender";
import { Spacers } from "../constants/spacers/spacers";

const SideNav = ({
  items,
  theme,
  variant,
  transitionDuration,
  className,
  styles,
  hideAccessbilityTools,
  expandedWidth,
  collapsedWidth,
  onSelect,
  onBottomItemClick,
  enableSearch,
  // Opt-in, default off: every existing consumer keeps the hover-only
  // behaviour untouched. `pinned` is owned by the caller so it can be
  // persisted per user rather than reset on every mount.
  pinnable = false,
  pinned = false,
  onPinnedChange,
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const isMultiRootTenant = Digit?.Utils?.getMultiRootTenant();
  const tenantId = Digit?.ULBService?.getStateId();
  const [hovered, setHovered] = useState(false);
  /**
   * Every layout decision below keys off this, not off `hovered` directly:
   * pinning has to hold the wide presentation open after the pointer leaves.
   * `hovered` keeps its original meaning and still only tracks the pointer.
   */
  const expanded = (pinnable && pinned) || hovered;
  const pinLabel = pinned
    ? t("CORE_SIDEBAR_COLLAPSE", "Collapse")
    : t("CORE_SIDEBAR_PIN", "Keep open");
  const [search, setSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState({});
  const [expandedItems, setExpandedItems] = useState({});

  const darkThemeColor = Colors.lightTheme.paper.primary;
  const lightThemeColor = Colors.lightTheme.primary[2];

  const primaryColor = theme === "dark" ? darkThemeColor : lightThemeColor;
  const iconSize = Spacers.spacer6;
  const bottomIconSize = Spacers.spacer4;

  useEffect(() => {
    const updateSelectedItem = (items, parentIndex) => {
      items?.forEach((item, index) => {
        if (item.children) {
          updateSelectedItem(item.children, index);
        } else if (item.navigationUrl) {
          let redirectionUrl = item.navigationUrl;
          if (isMultiRootTenant) {
            if (redirectionUrl.includes("sandbox-ui") && tenantId) {
              redirectionUrl = redirectionUrl.replace("/sandbox-ui/employee", `/sandbox-ui/${tenantId}/employee`);
            }
          }
          if (location.pathname.startsWith(redirectionUrl)) {
            setSelectedItem({ item: item, index, parentIndex });
          }
        }
      })
    }
    updateSelectedItem(items, -1);
  }, [location.pathname, items]);

  const handleArrowClick = (item, index, parentIndex) => {
    if (item.children) {
      setExpandedItems((prev) => ({
        ...prev,
        [index]: !prev[index],
      }));
    }
  };

  const handleItemClick = (item, index, parentIndex) => {
    setSelectedItem({ item: item, index: index, parentIndex: parentIndex });
    onSelect && onSelect({ item: item, index: index, parentIndex: parentIndex });
  };

  const isParentOfSelectedItem = (index) => {
    const { parentIndex } = selectedItem;
    return parentIndex && parentIndex.toString().startsWith(index);
  };

  const IconRender = (
    isSelected,
    isParentOfSelectedItem,
    iconReq,
    iconFill,
    width = iconSize,
    height = iconSize
  ) => {
    return iconRender(
      iconReq,
      iconFill ||
        (theme === "dark" ||
        (theme === "light" && variant === "primary" && isSelected && expanded) ||
        (theme === "light" &&
          variant === "primary" &&
          (isSelected || isParentOfSelectedItem) &&
          !expanded)
          ? darkThemeColor
          : lightThemeColor),
      width,
      height,
      `digit-sidebar-item-icon`
    );
  };

  const filterItems = (items, query) => {
    if (!query) {
      return items;
    }

    return items
      .map((item) => {
        if (item.label.toLowerCase().includes(query.toLowerCase())) {
          return item;
        }

        if (item.children) {
          const filteredChildren = filterItems(item.children, query);
          if (filteredChildren.length > 0) {
            return { ...item, children: filteredChildren };
          }
        }

        return null;
      })
      .filter((item) => item !== null);
  };

  const renderSearch = () => {
    return (
      <>
        {expanded ? (
          <div
            className={`digit-sidebar-search-container ${theme || ""} ${
              variant || ""
            }`}
          >
            <TextInput
              type="search"
              className="digit-sidebar-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("Search")}
              autoFocus={true}
              iconFill={primaryColor}
            ></TextInput>
          </div>
        ) : (
          <div
            className={`digit-sidebar-search-container-collapsed ${
              theme || ""
            } ${variant || ""}`}
          >
            <SVG.Search
              width={"24px"}
              height={"24px"}
              fill={theme === "dark" ? darkThemeColor : lightThemeColor}
              className="search-icon"
            />
          </div>
        )}
      </>
    );
  };

  const renderItems = (items, parentIndex = -1) => 
    items?.map((item, index) => {
      const currentIndex = parentIndex >= 0 ? `${parentIndex}-${index}` : index;
      const isExpanded = expandedItems[currentIndex];
      const isSelected = selectedItem.item === item;
      const isTopLevel = parentIndex === -1;

      return (
        <div className={"item-child-wrapper"} key={currentIndex}>
          <div
            className={`digit-sidebar-item ${theme || ""} ${variant || ""} ${
              selectedItem.item === item ? "selected" : ""
            } ${parentIndex === -1 ? "parentLevel" : ""} ${
              isParentOfSelectedItem(currentIndex) ? "selectedAsParent" : ""
            } ${expanded ? "hovered" : "collapsed"}`}
            onClick={() => handleItemClick(item, currentIndex, parentIndex)}
            tabIndex={0}
          >
            {(isTopLevel || expanded) && (
              <span className="icon">
                {(isSelected || isParentOfSelectedItem(currentIndex)) &&
                item?.selectedIcon
                  ? IconRender(
                      isSelected,
                      isParentOfSelectedItem(currentIndex),
                      item?.selectedIcon?.icon,
                      item?.selectedIcon?.iconFill,
                      item?.selectedIcon?.width,
                      item?.selectedIcon?.height
                    )
                  : IconRender(
                      isSelected,
                      isParentOfSelectedItem(currentIndex),
                      item?.icon?.icon,
                      item?.icon?.iconFill,
                      item?.icon?.width,
                      item?.icon?.height
                    )}
              </span>
            )}
            {expanded && <span className="item-label">{item.label}</span>}
            {item.children && expanded && (
              <span
                className="expand-icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleArrowClick(item, currentIndex, parentIndex);
                }}
              >
                {isExpanded ? (
                  <SVG.ArrowDropDown
                    fill={
                      theme === "dark" ||
                      (selectedItem.item === item &&
                        theme === "light" &&
                        variant === "primary")
                        ? darkThemeColor
                        : lightThemeColor
                    }
                  ></SVG.ArrowDropDown>
                ) : (
                  <SVG.ArrowDropDown
                    style={{ transform: "rotate(-90deg)" }}
                    fill={
                      theme === "dark" ||
                      (selectedItem.item === item &&
                        theme === "light" &&
                        variant === "primary")
                        ? darkThemeColor
                        : lightThemeColor
                    }
                  ></SVG.ArrowDropDown>
                )}
              </span>
            )}
          </div>
          {item.children && isExpanded && expanded && (
            <div className="digit-sidebar-children">
              {renderItems(item.children, currentIndex)}
            </div>
          )}
        </div>
      );
    });

  const filteredItems = filterItems(items, search);

  const getImageUrl = (imageKey) => {
    return IMAGES[imageKey];
  };

  const digitFooterImg =
    theme === "dark"
      ? getImageUrl("DIGIT_FOOTER_DARK")
      : getImageUrl("DIGIT_FOOTER_LIGHT");

  return (
    <div
      className={`digit-sidebar ${expanded ? "hovered" : "collapsed"} ${
        pinnable && pinned ? "pinned" : ""
      } ${theme || ""} ${variant || ""} ${enableSearch ? "" :"searchDisabled"} ${className || ""}`}
      style={{
        width:
          expanded && expandedWidth
            ? expandedWidth
            : !expanded && collapsedWidth
            ? collapsedWidth
            : undefined,
        // The width only animates when BOTH ends are concrete lengths. Given
        // no expandedWidth/collapsedWidth the element falls through to the
        // stylesheet, whose open state is `width:auto; min-width:15rem`, and
        // `auto` is not an animatable value — so the transition declared here
        // never ran and the panel jumped open. Callers passing both widths
        // get a real animation. The curve is stated rather than left to the
        // default `ease`, which reads slack over this distance.
        transition: `width ${transitionDuration || 0.5}s cubic-bezier(0.4, 0, 0.2, 1)`,
        ...styles,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {enableSearch && renderSearch()}
      <div
        className={`digit-sidebar-items-container ${theme || ""} ${
          variant || ""
        } ${enableSearch ? "" :"searchDisabled"}`}
      >
        {filteredItems.length > 0 ? (
          renderItems(filteredItems)
        ) : (
          expanded && <div className="digit-msb-no-results">{t("No Results Found")}</div>
        )}
      </div>
      {/* Foot of the rail, after the items. Placing it above them meant every
          expand shoved the whole nav list down by a row, which is a worse
          thing to watch than the control is worth. As the last flex child with
          `margin-top: auto` it settles at the bottom and the items never move.

          Only rendered once open: at 3rem the rail is an icon strip and has no
          room for an affordance whose whole purpose is to keep it wide. */}
      {pinnable && expanded && (
        <div className={`digit-sidebar-pin-row ${theme || ""}`}>
          <button
            type="button"
            className={`digit-sidebar-pin ${pinned ? "pinned" : ""}`}
            aria-pressed={pinned}
            aria-label={pinLabel}
            title={pinLabel}
            onClick={() => onPinnedChange && onPinnedChange(!pinned)}
          >
            {/* A chevron pointing the way the panel will go: left collapses it,
                right holds it open. Every nav rail people already use does this;
                a lock reads as permissions, not layout. */}
            {pinned ? (
              <SVG.ChevronLeft width={bottomIconSize} height={bottomIconSize} fill={primaryColor} />
            ) : (
              <SVG.ChevronRight width={bottomIconSize} height={bottomIconSize} fill={primaryColor} />
            )}
            <span className="digit-sidebar-pin-label">{pinLabel}</span>
          </button>
        </div>
      )}
      {expanded && !hideAccessbilityTools && (
        <div className={`digit-sidebar-bottom ${theme || ""} ${variant || ""}`}>
          <div>
            <div className="digit-sidebar-bottom-item" onClick={()=> onBottomItemClick && onBottomItemClick("Help")}>
              <SVG.Help width={bottomIconSize} height={bottomIconSize} fill={primaryColor} />
              <span className="digit-sidebar-bottom-item-text">{t("Help")}</span>
            </div>
            <div className={`digit-sidebar-bottom-item`} onClick={()=> onBottomItemClick && onBottomItemClick("Settings")}>
              <SVG.Settings
                width={bottomIconSize}
                height={bottomIconSize}
                fill={primaryColor}
              />
              <span className="digit-sidebar-bottom-item-text">{t("Settings")}</span>
            </div>
            <div className={`digit-sidebar-bottom-item`} onClick={()=>onBottomItemClick && onBottomItemClick("Logout")}>
              <SVG.Logout width={bottomIconSize} height={bottomIconSize} fill={primaryColor} />
              <span className="digit-sidebar-bottom-item-text">{t("Logout")}</span>
            </div>
            <hr className={`divider`}></hr>
          </div>
          <img
            className="digit-sidebar-footer-img"
            alt="Powered by DIGIT"
            src={digitFooterImg}
            onClick={() => {
              window
                .open(
                  window?.globalConfigs?.getConfig?.("DIGIT_HOME_URL"),
                  "_blank"
                )
                .focus();
            }}
          />
        </div>
      )}
    </div>
  );
};

SideNav.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      path: PropTypes.string,
      icon: PropTypes.object,
      label: PropTypes.string.isRequired,
      children: PropTypes.array,
    })
  ).isRequired,
  theme: PropTypes.oneOf(["dark", "light"]),
  variant: PropTypes.oneOf(["primary", "secondary"]),
  collapsedWidth: PropTypes.string,
  pinnable: PropTypes.bool,
  pinned: PropTypes.bool,
  onPinnedChange: PropTypes.func,
  expandedWidth: PropTypes.string,
  transitionDuration: PropTypes.number,
  styles: PropTypes.object,
  hideAccessbilityTools: PropTypes.bool,
  enableSearch: PropTypes.bool,
};

SideNav.defaultProps = {
  theme: "dark",
  variant: "primary",
  transitionDuration: 0.3,
  styles: {},
  enableSearch: true
};

export default SideNav;
