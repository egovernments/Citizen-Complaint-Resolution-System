import React from 'react';
import { FilterLiveForm, useListContext } from 'ra-core';
import { FilterFormInput } from './FilterFormInput';
import { AddFilterButton } from './AddFilterButton';

export interface FilterBarProps {
  filters: React.ReactElement[];
}

export function FilterBar({ filters }: FilterBarProps) {
  const { displayedFilters, showFilter, hideFilter } = useListContext();

  const alwaysOnFilters = filters.filter((f) => f.props.alwaysOn);
  const displayedNonAlwaysOn = filters.filter(
    (f) => !f.props.alwaysOn && displayedFilters?.[f.props.source]
  );

  return (
    <FilterLiveForm>
      <div className="flex items-center gap-2 flex-wrap">
        {alwaysOnFilters.map((f) => (
          <React.Fragment key={f.props.source}>{f}</React.Fragment>
        ))}
        {displayedNonAlwaysOn.map((f) => (
          <FilterFormInput
            key={f.props.source}
            filterElement={f}
            hideFilter={hideFilter}
          />
        ))}
        <AddFilterButton
          filters={filters}
          displayedFilters={displayedFilters ?? {}}
          showFilter={showFilter}
        />
      </div>
    </FilterLiveForm>
  );
}
