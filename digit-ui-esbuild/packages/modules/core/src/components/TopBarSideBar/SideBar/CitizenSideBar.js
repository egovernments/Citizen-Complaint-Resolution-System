// import { NavBar } from "@egovernments/digit-ui-react-components";
import { Loader } from "@egovernments/digit-ui-components";
import React, { useState, Fragment, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import { navigateToEmployeeUrl } from "./employeeNavItems";
import { defaultImage, resolveProfilePhoto } from "../../utils";
import StaticCitizenSideBar from "./StaticCitizenSideBar";
import { Hamburger } from "@egovernments/digit-ui-components";
import { DrawerFoot } from "./SidebarBrand";
import { trackEvent } from "../../analytics";
import { LogoutIcon } from "@egovernments/digit-ui-react-components";
import ImageComponent from "../../ImageComponent";

const Profile = ({ info, stateName, t }) => {
  // Prefer the session-cached photo so an in-place Edit-Profile save
  // shows up immediately — UserProfile.js writes the new value into
  // `Digit.UserService.getUser().info.photo` after a successful
  // update (CCRS#556 sub-bug pair fix). Fall back to the per-uuid
  // userSearch lookup only if the session doesn't already carry one
  // (e.g. on first login).
  const [profilePic, setProfilePic] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const stateId = Digit.ULBService.getStateId();
      let photo = info?.photo;
      if (!photo && info?.uuid) {
        const tenant = Digit.ULBService.getCurrentTenantId();
        const usersResponse = await Digit.UserService.userSearch(tenant, { uuid: [info.uuid] }, {});
        if (cancelled) return;
        photo = usersResponse?.user?.[0]?.photo;
      }
      // #445: photo may be a bare fileStoreId — resolve to a real URL before
      // it is used as an <img src>, otherwise the avatar shows the placeholder.
      const resolved = await resolveProfilePhoto(photo, stateId);
      if (!cancelled) setProfilePic(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [info?.uuid, info?.photo]);

  return (
    <div className="profile-section">
      <div className="imageloader imageloader-loaded">
        <ImageComponent
          className="img-responsive img-circle img-Profile"
          src={profilePic ? profilePic : defaultImage}
          style={{ objectFit: "cover", objectPosition: "center" }}
          alt="Profile Image"
        />
      </div>
      {info?.name && info?.name !== info?.mobileNumber && (
        <div id="profile-name" className="label-container name-Profile">
          <div className="label-text"> {info.name} </div>
        </div>
      )}
      <div id="profile-location" className="label-container loc-Profile">
        <div className="label-text"> {info?.mobileNumber} </div>
      </div>
      {info?.emailId && (
        <div id="profile-emailid" className="label-container loc-Profile">
          <div className="label-text"> {info.emailId} </div>
        </div>
      )}
      <div className="profile-divider"></div>
    </div>
  );
};

/* 
Feature :: Citizen Webview sidebar
*/
export const CitizenSideBar = ({
  isOpen,
  isMobile = false,
  toggleSidebar,
  onLogout,
  isEmployee = false,
  // The rows the desktop rail renders, for whichever app this is. Supplied by
  // the Employee/Citizen mobile wrappers rather than fetched here, so the
  // citizen drawer never mounts the employee access-control query.
  navItems = [],
  linkData,
  islinkDataLoading,
  userProfile,
}) => {
  const isMultiRootTenant = Digit.Utils.getMultiRootTenant();
  const { data: storeData, isFetched } = Digit.Hooks.useStore.getInitData();
  const selectedLanguage = Digit.StoreData.getCurrentLanguage();
  const [profilePic, setProfilePic] = useState(null);
  const { languages, stateInfo } = storeData || {};
  const user = Digit.UserService.getUser();
  const [search, setSearch] = useState("");
  const [selected, setselected] = useState(selectedLanguage);
  const { isLoading, data } = Digit.Hooks.useAccessControl();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const { t } = useTranslation();
  const history = useHistory();

  const closeSidebar = () => {
    Digit.clikOusideFired = true;
    toggleSidebar(false);
  };

  useEffect(() => {
    const fetchUserProfile = async () => {
      const tenant = Digit.ULBService.getCurrentTenantId();
      const uuid = user?.info?.uuid;
      if (uuid) {
        const usersResponse = await Digit.UserService.userSearch(tenant, { uuid: [uuid] }, {});
        const userData = usersResponse?.user?.[0];
        if (userData) {
          const currentUser = Digit.UserService.getUser();
          Digit.UserService.setUser({
            ...currentUser,
            info: userData
          });
        }
        if (usersResponse && usersResponse.user && usersResponse?.user?.length) {
          const userDetails = usersResponse.user[0];
          // #445: photo may be a bare fileStoreId — resolve to a real URL so
          // the sidebar avatar renders instead of falling back to a glyph.
          const resolved = await resolveProfilePhoto(userDetails?.photo, Digit.ULBService.getStateId());
          setProfilePic(resolved);
        }
      }
    };
    if (!profilePic) {
      fetchUserProfile();
    }
  }, [profilePic]);

  const handleChangeLanguage = (language) => {
    setselected(language.value);
    Digit.LocalizationService.changeLanguage(language.value, stateInfo.code);
  };

  const handleModuleClick = (url) => {
    let updatedUrl = null;
    if (Digit.Utils.getMultiRootTenant()) {
      updatedUrl = isEmployee
        ? url.replace("/sandbox-ui/employee", `/sandbox-ui/${tenantId}/employee`)
        : url.replace("/sandbox-ui/citizen", `/sandbox-ui/${tenantId}/citizen`);
      history.push(updatedUrl);
      toggleSidebar();
    } else {
      // Some MDMS-driven URLs (e.g. naipepea's `pgr-home` link) ship as
      // absolute paths already (`/digit-ui/citizen/pgr-home`). The
      // legacy branch unconditionally prepended `/<context>/<userType>`
      // which produced `/digit-ui/citizen/digit-ui/citizen/pgr-home` —
      // 404 + blank screen. Detect the absolute-rooted shape and push
      // it as-is; only fold in the prefix when we get a relative URL.
      const role = isEmployee ? "employee" : "citizen";
      const rootedHere = `/${window?.contextPath}/${role}`;
      if (typeof url === "string" && url.startsWith(rootedHere)) {
        history.push(url);
      } else if (typeof url === "string" && url.startsWith("/")) {
        history.push(`/${window?.contextPath}/${role}${url}`);
      } else {
        history.push(`/${window?.contextPath}/${role}/${url}`);
      }
      toggleSidebar();
    }
  };

  const redirectToLoginPage = () => {
    if (isEmployee) {
      history.push(`/${window?.contextPath}/employee/user/language-selection`);
    } else {
      history.push(`/${window?.contextPath}/citizen/login`);
    }
    closeSidebar();
  };

  if (islinkDataLoading || isLoading) {
    return <Loader />;
  }

  let menuItems = [
    {
      id: "login-btn",
      element: "LOGIN",
      text: t("CORE_COMMON_LOGIN"),
      icon: <LogoutIcon className="icon" />,
      populators: {
        onClick: redirectToLoginPage,
      },
    },
  ];

  let profileItem;
  if (isFetched && user && user.access_token) {
    profileItem = <Profile info={user?.info} stateName={stateInfo?.name} t={t} />;
    menuItems = menuItems.filter((item) => item?.id !== "login-btn");
  }


  if (!isEmployee) {
    Object.keys(linkData)
      ?.sort((x, y) => y.localeCompare(x))
      ?.map((key) => {
        if (linkData[key][0]?.sidebar === `${Digit.Utils.mdmsAppId()}-links`)
          menuItems.splice(1, 0, {
            type: Digit.Utils.rebaseAppUrl(linkData[key][0]?.sidebarURL)?.includes(window?.contextPath) ? "link" : "external-link",
            text: t(`ACTION_TEST_${Digit.Utils.locale.getTransformedLocale(key)}`),
            links: linkData[key],
            icon: linkData[key][0]?.leftIcon,
            link: Digit.Utils.rebaseAppUrl(linkData[key][0]?.sidebarURL),
          });
      });
  }
  // The employee branch that used to live here rebuilt the module rows from
  // `data.actions` into `menuItems`. Those rows now come from
  // the `navItems` prop, and `menuItems` is no
  // longer rendered on the employee drawer at all, so the whole build was
  // running on every render and having its output discarded.

  /*  URL with openlink wont have sidebar and actions    */
  if (history.location.pathname.includes("/openlink")) {
    profileItem = <span></span>;
    menuItems = menuItems.filter((ele) => ele.element === "LANGUAGE");
  }

  menuItems = menuItems?.map((item) => ({
    ...item,
    label: item?.text || item?.moduleName || "",
    icon: item?.icon ? item?.icon : undefined,
  }));

  const goToHome = () => {
    if (isEmployee) {
      history.push(`/${window?.contextPath}/employee`);
    } else {
      history.push(`/${window?.contextPath}/citizen`);
    }
  };
  const onItemSelect = ({ item, index, parentIndex }) => {
    if (item?.navigationUrl) {
      // Employee nav rows carry `navigationUrl`; the citizen rows below use
      // `navigationURL` / `link`. Routed through the same helper the desktop
      // SideNav uses so external links and multi-root tenants behave alike.
      navigateToEmployeeUrl(history, item?.navigationUrl, {
        isMultiRootTenant: Digit.Utils.getMultiRootTenant(),
        tenantId: Digit.ULBService.getStateId(),
      });
      toggleSidebar();
    } else if (item?.navigationURL) {
      handleModuleClick(item?.navigationURL);
    } else if (item?.link) {
      handleModuleClick(item?.link);
    } else if (item?.id === "login-btn" || item?.element === "LOGIN") {
      // The Login row sits inside the Modules submenu and only carries
      // a `populators.onClick` (legacy convention from <SideBarMenu>).
      // Hamburger doesn't propagate populators — it just hands the
      // selected item back to us here, so we have to call the redirect
      // ourselves. Without this branch, tapping Login was a no-op.
      redirectToLoginPage();
      toggleSidebar();
    } else if (item?.type === "custom") {
      switch (item?.key) {
        case "home":
          goToHome();
          toggleSidebar();
          break;
        case "login":
          redirectToLoginPage();
          toggleSidebar();
          break;
        case "editProfile":
          userProfile();
          toggleSidebar();
          break;
        case "language":
          handleChangeLanguage(item);
          toggleSidebar();
          break;
      }
    } else if (typeof item?.populators?.onClick === "function") {
      // Generic fallback — any future menu items that follow the
      // legacy populators convention work without an explicit branch.
      item.populators.onClick();
      toggleSidebar();
    }
  };

  const transformedMenuItems = menuItems?.map((item) => {
    if (item?.type === "dynamic") {
      return {
        ...item,
        children: item?.links?.map((link) => ({
          ...link,
          label: link?.displayName,
          icon: link?.leftIcon,
        })),
      };
    } else {
      return item;
    }
  });

  // On employee the access-control tree already supplies Home (and the
  // module rows, and Dashboard) so the hardcoded HOME row would duplicate it.
  // Before this, the drawer had neither: the employee branch built no module
  // rows at all, so "Modules" opened onto "No Tenants Found" and there was no
  // way to reach the dashboard from a phone (#2038 mobile review).
  // The account rows under the navigation: Edit Profile. The tenant comes
  // from the URL (#2167), so there is no tenant switcher.
  const accountRows = [
    // Language is the pill in the phone bar now (#2038 design), so the drawer
    // no longer repeats it.
    ...(user && user.access_token
      ? [
          {
            label: t("EDIT_PROFILE"),
            type: "custom",
            icon: "Edit",
            key: "editProfile",
          },
        ]
      : []),
  ];

  // The rail's own rows when the app supplies them (both apps do now), so
  // the drawer and the desktop rail list the same destinations. The bare
  // HOME row is only the fallback for a caller that passes none.
  const navRows =
    isEmployee || navItems.length
      ? navItems
      : [
          {
            label: "HOME",
            value: "HOME",
            icon: "Home",
            type: "custom",
            key: "home",
          },
        ];
  // One faint line under the last grouped section, as the desktop rail draws
  // it, and no other lines in the drawer (#2038 mobile review). Rows after the
  // sections (Dashboard, configured links) go under the line with the account
  // rows; without sections the line sits above the account rows.
  const splitAt = navRows.map((item) => item?.type).lastIndexOf("section") + 1;
  const treeRows = splitAt > 0 ? navRows.slice(0, splitAt) : navRows;
  const belowRows = [...(splitAt > 0 ? navRows.slice(splitAt) : []), ...accountRows];

  const hamburgerItems = [
    // The employee drawer also renders logged out (SideBar/index.js falls to
    // this branch when there is no access_token), and `login-btn` used to reach
    // it inside the Modules group that employees no longer get. Without this
    // there is no way to sign in from the drawer on a phone.
    ...(isEmployee && !user?.access_token
      ? [{ label: t("CORE_COMMON_LOGIN"), type: "custom", icon: "Login", key: "login" }]
      : []),
    ...treeRows,
    ...(treeRows.length > 0 && belowRows.length > 0 ? [{ type: "divider", key: "tree-divider" }] : []),
    ...belowRows,
    // Only for a caller without rail rows: with them, the modules' sections,
    // the MDMS-configured links and Login are already above, and this group
    // would repeat them.
    ...(isEmployee || navItems.length
      ? []
      : [
          {
            label: t("Modules"),
            icon: "DriveFileMove",
            children: transformedMenuItems,
          },
        ]),
  ];
  return isMobile ? (
    <Hamburger
      items={hamburgerItems}
      profileName={user?.info?.name}
      profileNumber={user?.info?.mobileNumber || user?.info?.emailId}
      // theme="dark" — match the v2 desktop sidebar's themed green
      // surface (`--color-sidebar-bg`). The earlier `theme="light"`
      // tracked the v2 desktop sidebar when it was white, but that
      // got reverted to themed green after testers flagged the white
      // drawer as out-of-place vs the green topbar.
      theme="dark"
      transitionDuration={0.3}
      // Drop the inline marginTop:"64px" — that was tuned for an older
      // 64px topbar and now leaves a thin white strip between the topbar
      // bottom and the drawer top. CSS in overrides.css aligns the
      // drawer flush against the actual topbar height instead.
      styles={{ height: "93%" }}
      // The drawer's Logout is the shared component's own button, which takes
      // no analytics tag, so its outcome is sent from here.
      onLogout={
        onLogout
          ? () => {
              trackEvent("shell.drawer.logout", { category: "shell" });
              onLogout();
            }
          : undefined
      }
      hideUserManuals={true}
      profile={profilePic ? profilePic : undefined}
      isSearchable={true}
      // Close drawer when the user taps anywhere outside it. Listener
      // registration is delayed by a tick (see Hamburger atom) so the
      // open-click doesn't immediately re-close the drawer.
      closeOnClickOutside={true}
      onOutsideClick={() => toggleSidebar(false)}
      onSelect={({ item, index, parentIndex }) => onItemSelect({ item, index, parentIndex })}
      // On a phone the crest stays in the top bar right above the drawer, so
      // the drawer takes just the eGov foot; a crest here too would show the
      // same mark twice.
      renderFooter={() => <DrawerFoot />}
    />
  ) : (
    <StaticCitizenSideBar logout={onLogout} />
  );
};