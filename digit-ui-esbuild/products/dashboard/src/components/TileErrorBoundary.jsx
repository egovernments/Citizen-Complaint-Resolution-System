import React from "react";

/**
 * ours (digit-3 P0, 2026-10-14): one dashboard widget that throws while rendering shows a short note in its own card
 * instead of unmounting the whole dashboard.
 */
export default class TileErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error("dashboard widget failed", this.props.kpiId, error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-p-3 tw-text-sm tw-text-gray-500" role="note" data-testid="tile-error">
          This chart could not be shown.
        </div>
      );
    }
    return this.props.children;
  }
}
