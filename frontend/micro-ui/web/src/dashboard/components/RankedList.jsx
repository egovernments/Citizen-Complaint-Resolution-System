import React from "react";

const RankedList = ({ items }) => (
  <ol className="tw-m-0 tw-list-none tw-w-full tw-space-y-1 tw-p-0">
    {items.map((item) => (
      <li
        key={`${item.rank}-${item.label}`}
        className="tw-flex tw-items-center tw-justify-between tw-rounded-sm tw-bg-muted tw-py-1.5"
      >
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <span className="tw-flex tw-h-5 tw-w-5 tw-flex-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-bg-primary tw-text-[10px] tw-font-bold tw-text-primary-foreground">
            {item.rank}
          </span>
          <span
            className="tw-line-clamp-2 tw-text-[12px] tw-leading-snug tw-text-foreground"
            title={item.label}
          >
            {item.label}
          </span>
        </div>
        <span className="tw-ml-2 tw-flex-shrink-0 tw-text-[12px] tw-font-semibold tw-tabular-nums tw-text-foreground">
          {item.value}
        </span>
      </li>
    ))}
  </ol>
);

export default RankedList;
