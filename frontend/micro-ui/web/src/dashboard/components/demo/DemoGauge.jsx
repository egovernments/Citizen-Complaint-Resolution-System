import React from "react";
import { VISUALIZATION_STYLES, VIZ_TYPE } from "../../config/visualizationStyles";

const DemoGauge = ({ value = 0, target = 90 }) => {
  const pct = Math.min(100, Math.max(0, value));
  const onTrack = pct >= target;
  const gap = Math.max(0, target - pct);
  const styles = VISUALIZATION_STYLES[VIZ_TYPE.GAUGE];
  const targetLabel = `Target: ${target}%`;

  return (
    <>
      <div className={styles.value}>{pct}%</div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${pct}%` }} />
        <div
          className={styles.targetMarker}
          style={{ left: `${target}%` }}
          aria-label={targetLabel}
          tabIndex={0}
        >
          <span className={styles.targetLine} aria-hidden />
          <span className={styles.targetTooltip}>{targetLabel}</span>
        </div>
      </div>
      <div className={styles.status}>
        {onTrack ? "On track" : `${gap}% below goal`}
      </div>
    </>
  );
};

export default DemoGauge;
