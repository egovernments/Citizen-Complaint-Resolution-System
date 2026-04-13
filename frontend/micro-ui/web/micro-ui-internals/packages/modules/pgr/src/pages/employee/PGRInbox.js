import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader, Header } from "@egovernments/digit-ui-react-components";

import DesktopInbox from "../../components/DesktopInbox";
import MobileInbox from "../../components/MobileInbox";

const PGRSearchInbox = () => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const { uuid } = Digit.UserService.getUser().info;
  const [pageOffset, setPageOffset] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [totalRecords, setTotalRecords] = useState(0);
  const [searchParams, setSearchParams] = useState({ filters: { wfFilters: { assignee: [{ code: uuid }] } }, search: "", sort: {} });

  const fetchNextPage = () => {
    setPageOffset((prevState) => prevState + pageSize);
  };

  const fetchPrevPage = () => {
    setPageOffset((prevState) => prevState - pageSize);
  };

  const handlePageSizeChange = (e) => {
    setPageSize(Number(e.target.value));
  };

  const handleFilterChange = (filterParam) => {
    setSearchParams({ ...searchParams, filters: filterParam });
  };

  const onSearch = (params = "") => {
    setSearchParams({ ...searchParams, search: params });
  };

  let { data: complaints, isLoading } = Digit.Hooks.pgr.useInboxData({ ...searchParams, offset: pageOffset, limit: pageSize });

  // BUG-4 fix: /pgr-services/v2/request/_count does not exist.
  // Compute total records from the search results instead.
  // Must be declared AFTER the useInboxData hook (complaints is a let binding).
  useEffect(() => {
    if (complaints?.length !== undefined) {
      setTotalRecords(complaints.length);
    }
  }, [complaints]);

  let isMobile = Digit.Utils.browser.isMobile();

  if (isLoading || complaints === undefined) {
    return <Loader />;
  }

  if (isMobile) {
    return (
      <MobileInbox data={complaints} isLoading={isLoading} onFilterChange={handleFilterChange} onSearch={onSearch} searchParams={searchParams} />
    );
  }

  return (
    <div>
      <Header>{t("ES_COMMON_INBOX")}</Header>
      <DesktopInbox
        data={complaints}
        isLoading={isLoading}
        onFilterChange={handleFilterChange}
        onSearch={onSearch}
        searchParams={searchParams}
        onNextPage={fetchNextPage}
        onPrevPage={fetchPrevPage}
        onPageSizeChange={handlePageSizeChange}
        currentPage={Math.floor(pageOffset / pageSize)}
        totalRecords={totalRecords}
        pageSizeLimit={pageSize}
      />
    </div>
  );
};

export default PGRSearchInbox;
