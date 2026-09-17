import { CardText, Dropdown } from "@egovernments/digit-ui-components";
import React, { useEffect, useState } from "react";
import { useHistory } from "react-router-dom";

const stringReplaceAll = (str = "", searcher = "", replaceWith = "") => {
  if (searcher == "") return str;
  while (str?.includes(searcher)) {
    str = str?.replace(searcher, replaceWith);
  }
  return str;
};

/**
 * Whether the tenant switcher has a job to do.
 *
 * The list is built from the signed-in user's own roles, so on a deployment
 * where they hold roles in one tenant it renders a dropdown with a single
 * entry that switches to where you already are. That is the "Ke" control
 * #2038 asked to hide.
 *
 * `SHOW_TENANT_SWITCHER` overrides in either direction for a deployment that
 * wants to decide for itself: true keeps it even with one tenant, false hides
 * it even where switching is possible. Unset falls back to the useful rule.
 *
 * Exported so the mobile drawer, which builds its own city row rather than
 * rendering this component, cannot drift from the top bar.
 */
export const tenantChoiceCount = () => {
  const roles = Digit?.SessionStorage?.get?.("citizen.userRequestObject")?.info?.roles || [];
  return new Set(roles.map((role) => role?.tenantId).filter(Boolean)).size;
};

export const showTenantSwitcher = (tenantCount) => {
  const flag = window?.globalConfigs?.getConfig?.("SHOW_TENANT_SWITCHER");
  if (typeof flag === "boolean") return flag;
  // Callers that already have the list pass its length; callers that do not
  // (the top bar, which has to decide before rendering the component) let it
  // work the count out from the same roles the list is built from.
  const count = typeof tenantCount === "number" ? tenantCount : tenantChoiceCount();
  return count > 1;
};

const ChangeCity = (prop) => {
  const [dropDownData, setDropDownData] = useState(null);
  const [selectCityData, setSelectCityData] = useState([]);
  const [selectedCity, setSelectedCity] = useState([]); //selectedCities?.[0]?.value
  const history = useHistory();
  const isDropdown = prop.dropdown || false;
  let selectedCities = [];
  const isMultiRootTenant = Digit.Utils.getMultiRootTenant();

  const handleChangeCity = (city) => {
    const loggedInData = Digit.SessionStorage.get("citizen.userRequestObject");
    const filteredRoles = Digit.SessionStorage.get("citizen.userRequestObject")?.info?.roles?.filter((role) => role.tenantId === city.value);
    if (filteredRoles?.length > 0) {
      loggedInData.info.roles = filteredRoles;
      loggedInData.info.tenantId = city?.value;
    }
    Digit.SessionStorage.set("Employee.tenantId", city?.value);
    Digit.UserService.setUser(loggedInData);
    setDropDownData(city);
    if (window.location.href.includes(`/${window?.contextPath}/employee/`)) {
      const redirectPath = location.state?.from || `/${window?.contextPath}/employee`;
      history.replace(redirectPath);
    }
    window.location.reload();
  };

  useEffect(() => {
    const userloggedValues = Digit.SessionStorage.get("citizen.userRequestObject");
    let teantsArray = [],
      filteredArray = [];
    userloggedValues?.info?.roles?.forEach((role) => teantsArray.push(role.tenantId));
    let unique = teantsArray.filter((item, i, ar) => ar.indexOf(item) === i);
    unique?.forEach((uniCode) => {
      filteredArray.push({
        label: `TENANT_TENANTS_${stringReplaceAll(uniCode, ".", "_")?.toUpperCase()}`,
        value: uniCode,
      });
    });
    selectedCities = filteredArray?.filter((select) => select.value == Digit.SessionStorage.get("Employee.tenantId"));
    setSelectCityData(filteredArray);
  }, [dropDownData]);

  if (!showTenantSwitcher(selectCityData?.length)) return null;

  // if (isDropdown) {
  return (
    <div style={prop?.mobileView ? { color: "#767676" } : {}}>
      {
        (isMultiRootTenant && selectCityData.length==1) ? 
        <CardText style={{color:"#363636"}}>{selectCityData?.[0]?.value}</CardText>
        :
      <Dropdown
        t={prop?.t}
        option={selectCityData}
        selected={selectCityData.find((cityValue) => cityValue.value === dropDownData?.value)}
        optionKey={"label"}
        select={handleChangeCity}
        freeze={true}
        customSelector={
          <label className="cp">
            {prop?.t(`TENANT_TENANTS_${stringReplaceAll(Digit.SessionStorage.get("Employee.tenantId"), ".", "_")?.toUpperCase()}`)}
          </label>
        }
      />
}
    </div>
  );
  // } else {
  //   return (
  //     <React.Fragment>
  //       <div style={{ marginBottom: "5px" }}>City</div>
  //       <div className="language-selector" style={{display: "flex", flexWrap: "wrap"}}>
  //         {selectCityData?.map((city, index) => (
  //           <div className="language-button-container" key={index}>
  //             <CustomButton
  //               selected={city.value === Digit.SessionStorage.get("Employee.tenantId")}
  //               text={city.label}
  //               onClick={() => handleChangeCity(city)}
  //             ></CustomButton>
  //           </div>
  //         ))}
  //       </div>
  //     </React.Fragment>
  //   );
  // }
};

export default ChangeCity;
