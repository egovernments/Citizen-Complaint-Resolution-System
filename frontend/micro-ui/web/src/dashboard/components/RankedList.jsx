import React from "react";

const RankedList = ({ items }) => (
  <div className="dashboard-widget tw-flex tw-h-full tw-flex-col tw-p-4">
    <ol className="tw-flex-1 tw-space-y-2 tw-overflow-y-auto">
      {items.map((item) => (
        <li
          key={`${item.rank}-${item.label}`}
          className="tw-flex tw-items-center tw-justify-between tw-rounded-md tw-bg-slate-50 tw-px-3 tw-py-2"
        >
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <span className="tw-flex tw-h-6 tw-w-6 tw-flex-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-brand-teal tw-text-xs tw-font-bold tw-text-white">
              {item.rank}
            </span>
            <span className="tw-line-clamp-2 tw-text-sm tw-leading-snug tw-text-slate-700" title={item.label}>
              {item.label}
            </span>
          </div>
          <span className="tw-ml-2 tw-flex-shrink-0 tw-text-sm tw-font-semibold tw-text-slate-800">
            {item.value}
          </span>
        </li>
      ))}
    </ol>
  </div>
);

export default RankedList;
