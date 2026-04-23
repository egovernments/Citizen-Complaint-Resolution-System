import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader, Header } from "@egovernments/digit-ui-react-components";
import DesktopInbox from "../../components/DesktopInbox";
import MobileInbox from "../../components/MobileInbox";

const PGRInboxV1 = () => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const { uuid } = Digit.UserService.getUser().info;

  const [pageOffset, setPageOffset] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [totalRecords, setTotalRecords] = useState(0);
  const [searchParams, setSearchParams] = useState({
    filters: { wfFilters: { assignee: [] } },
    search: "",
    sort: {},
  });

  useEffect(() => {
    (async () => {
      const applicationStatus = searchParams?.filters?.pgrfilters?.applicationStatus?.map((e) => e.code).join(",");
      const response = await Digit.PGRService.count(tenantId, applicationStatus?.length > 0 ? { applicationStatus } : {});
      if (response?.count) {
        setTotalRecords(response.count);
      }
    })();
  }, [searchParams]);

  const fetchNextPage = () => setPageOffset((prev) => prev + 10);
  const fetchPrevPage = () => setPageOffset((prev) => prev - 10);
  const handlePageSizeChange = (e) => setPageSize(Number(e.target.value));
  const handleFilterChange = (filterParam) => setSearchParams({ ...searchParams, filters: filterParam });
  const onSearch = (params = "") => setSearchParams({ ...searchParams, search: params });

  const { data: complaints, isLoading } = Digit.Hooks.pgr.useInboxData({
    ...searchParams,
    offset: pageOffset,
    limit: pageSize,
  });

  const isMobile = Digit.Utils.browser.isMobile();

  if (complaints?.length !== null) {
    if (isMobile) {
      return (
        <MobileInbox
          data={complaints}
          isLoading={isLoading}
          onFilterChange={handleFilterChange}
          onSearch={onSearch}
          searchParams={searchParams}
        />
      );
    } else {
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
    }
  }

  return <Loader />;
};

export default PGRInboxV1;
