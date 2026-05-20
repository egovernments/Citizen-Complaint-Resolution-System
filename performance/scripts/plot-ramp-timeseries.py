#!/usr/bin/env python3
"""Plot time-series chart for all ramp-300vu test results.

Shows how each resource profile performs over the 10-minute ramp duration:
  - Top: p95 HTTP request latency over time (30s rolling windows)
  - Middle: HTTP error rate over time (30s rolling windows)
  - Bottom: VU count over time (shared across all profiles)

Filters:
  --empty-only   Only plot empty-DB results (for the empty-DB chart)
  --1m-only      Only plot 1M-record results
  --all          Plot everything (default)
"""
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import glob
import os
import sys
import argparse

RESULTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'results')
DOCS_PUBLIC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'public')


def load_timeseries(result_dir):
    """Load k6 CSV and build 30-second rolling windows for latency and error rate."""
    csv_path = os.path.join(result_dir, 'metrics.csv')
    if not os.path.exists(csv_path):
        return None

    df = pd.read_csv(csv_path, low_memory=False)

    # VU timeseries
    vus = df[df['metric_name'] == 'vus'][['timestamp', 'metric_value']].copy()
    vus.columns = ['timestamp', 'vus']
    vus['timestamp'] = pd.to_numeric(vus['timestamp'])
    vus = vus.sort_values('timestamp')
    t0 = vus['timestamp'].min()
    vus['elapsed_min'] = (vus['timestamp'] - t0) / 60.0

    # HTTP request durations (main scenario, server-side latency)
    http_dur = df[(df['metric_name'] == 'http_req_duration') & (df['scenario'] == 'main')][['timestamp', 'metric_value']].copy()
    http_dur.columns = ['timestamp', 'duration_ms']
    http_dur['timestamp'] = pd.to_numeric(http_dur['timestamp'])
    http_dur['elapsed_min'] = (http_dur['timestamp'] - t0) / 60.0

    # HTTP failures (main scenario)
    http_fail = df[(df['metric_name'] == 'http_req_failed') & (df['scenario'] == 'main')][['timestamp', 'metric_value']].copy()
    http_fail.columns = ['timestamp', 'is_error']
    http_fail['timestamp'] = pd.to_numeric(http_fail['timestamp'])
    http_fail['elapsed_min'] = (http_fail['timestamp'] - t0) / 60.0

    if http_dur.empty:
        return None

    # Create 30-second time bins
    bin_size_min = 0.5  # 30 seconds
    max_min = http_dur['elapsed_min'].max()
    bins = np.arange(0, max_min + bin_size_min, bin_size_min)
    bin_centers = (bins[:-1] + bins[1:]) / 2

    # Latency percentiles per bin
    http_dur['bin'] = pd.cut(http_dur['elapsed_min'], bins=bins, labels=bin_centers, include_lowest=True)
    latency_stats = http_dur.groupby('bin', observed=True)['duration_ms'].agg(
        p50='median',
        p95=lambda x: np.percentile(x, 95) if len(x) > 0 else np.nan,
        count='count'
    ).reset_index()
    latency_stats['bin'] = latency_stats['bin'].astype(float)

    # Error rate per bin
    http_fail['bin'] = pd.cut(http_fail['elapsed_min'], bins=bins, labels=bin_centers, include_lowest=True)
    error_stats = http_fail.groupby('bin', observed=True).agg(
        total=('is_error', 'count'),
        errors=('is_error', 'sum')
    ).reset_index()
    error_stats['bin'] = error_stats['bin'].astype(float)
    error_stats['error_rate'] = (error_stats['errors'] / error_stats['total'] * 100).fillna(0)

    return {
        'vus': vus,
        'latency': latency_stats,
        'errors': error_stats,
    }


def parse_dir_name(dirname):
    """Extract machine and profile from directory name."""
    parts = dirname.split('_')
    if len(parts) >= 4:
        machine = parts[1]
        profile = parts[2]
        return f"{machine} / {profile}"
    return dirname


def main():
    parser = argparse.ArgumentParser(description='Plot ramp-300vu time-series chart')
    parser.add_argument('--empty-only', action='store_true', help='Only empty-DB results')
    parser.add_argument('--1m-only', action='store_true', help='Only 1M-record results')
    parser.add_argument('--output', default=None, help='Output file path')
    args = parser.parse_args()

    # Find all ramp-300vu result directories
    pattern = os.path.join(RESULTS_DIR, '*_ramp-300vu')
    dirs = sorted(glob.glob(pattern))

    # Filter to latest run per machine/profile combo
    latest = {}
    for d in dirs:
        name = os.path.basename(d)
        parts = name.split('_')
        if len(parts) >= 4:
            key = f"{parts[1]}_{parts[2]}"
            latest[key] = d
    dirs = list(latest.values())

    # Apply filter
    if args.empty_only:
        dirs = [d for d in dirs if '1M' not in os.path.basename(d)]
    elif getattr(args, '1m_only'):
        dirs = [d for d in dirs if '1M' in os.path.basename(d)]

    if not dirs:
        print("No matching results found!")
        sys.exit(1)

    print(f"Found {len(dirs)} test results:")
    for d in dirs:
        print(f"  {os.path.basename(d)}")

    # Load all data
    datasets = {}
    for d in dirs:
        label = parse_dir_name(os.path.basename(d))
        data = load_timeseries(d)
        if data:
            datasets[label] = data
            print(f"  Loaded {label}: {len(data['latency'])} time bins")

    if not datasets:
        print("No data loaded!")
        sys.exit(1)

    # Sort labels for consistent ordering
    sorted_labels = sorted(datasets.keys())

    # Colors and styles
    colors = {
        'dev / 4c-8g': '#E91E63',     # Pink — smallest, most constrained
        'prod / 4c-8g': '#FF9800',     # Orange
        'prod / 8c-16g': '#2196F3',    # Blue
        'dev / 8c-16g': '#4CAF50',     # Green — matches dev machine
        'prod / 16c-32g': '#7B1FA2',   # Purple — biggest profile
        'prod / 8c-16g-1M': '#2196F3', # Blue (dashed for 1M)
        'prod / 16c-32g-1M': '#7B1FA2', # Purple (dashed for 1M)
    }
    default_colors = ['#2196F3', '#FF9800', '#4CAF50', '#E91E63', '#9C27B0', '#00BCD4', '#795548']

    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(14, 10), sharex=True,
                                         gridspec_kw={'height_ratios': [3, 2, 1]})

    # Use first dataset's VU timeseries for the bottom panel (all share same ramp)
    ref_data = datasets[sorted_labels[0]]
    ref_vus = ref_data['vus']

    for i, label in enumerate(sorted_labels):
        data = datasets[label]
        color = colors.get(label, default_colors[i % len(default_colors)])
        is_1m = '1M' in label
        linestyle = '--' if is_1m else '-'
        linewidth = 2.2
        marker = 's' if is_1m else 'o'

        lat = data['latency']
        x = lat['bin']

        # Latency panel — p95 line + p50 line (thinner)
        ax1.plot(x, lat['p95'] / 1000, linestyle, color=color, label=f'{label}',
                 linewidth=linewidth, alpha=0.9, marker=marker, markersize=3)

        # Error rate panel
        err = data['errors']
        ax2.plot(err['bin'], err['error_rate'], linestyle, color=color, label=label,
                 linewidth=linewidth, alpha=0.9, marker=marker, markersize=3)

    # VU count panel (shared — use any dataset, they all have the same ramp)
    ax3.fill_between(ref_vus['elapsed_min'], 0, ref_vus['vus'], color='#E3F2FD', alpha=0.8)
    ax3.plot(ref_vus['elapsed_min'], ref_vus['vus'], color='#1565C0', linewidth=1.5)

    # Add VU count labels on top x-axis of latency chart
    ax1_top = ax1.twiny()
    vu_ticks_min = [2, 4, 6, 8, 10, 12]  # minutes
    vu_labels = []
    for t in vu_ticks_min:
        row = ref_vus[ref_vus['elapsed_min'].round(1) == t]
        if not row.empty:
            vu_labels.append(f'{int(row.iloc[0]["vus"])} VUs')
        else:
            vu_labels.append('')
    ax1_top.set_xlim(ax1.get_xlim())
    ax1_top.set_xticks(vu_ticks_min)
    ax1_top.set_xticklabels(vu_labels, fontsize=8, color='#666')

    # Annotations
    ax1.axhline(y=15, color='red', linestyle=':', alpha=0.4, linewidth=1)
    ax1.text(0.3, 16, 'p95 threshold (15s)', color='red', alpha=0.5, fontsize=8)

    ax2.axhline(y=5, color='red', linestyle=':', alpha=0.4, linewidth=1)
    ax2.text(0.3, 7, '5% error threshold', color='red', alpha=0.5, fontsize=8)

    # Phase annotations on VU panel
    ax3.axvline(x=2, color='gray', linestyle=':', alpha=0.4)
    ax3.text(0.3, 260, 'warmup', fontsize=8, color='gray', alpha=0.7)
    ax3.text(6, 260, 'main ramp (0→300 VUs)', fontsize=9, color='gray', alpha=0.7)

    # Formatting
    ax1.set_ylabel('p95 Latency (seconds)')
    ax1.set_title('DIGIT PGR: Resource Profile Performance Over Time (ramp 0→300 VUs)', pad=25)
    ax1.legend(loc='upper left', fontsize=8, ncol=2, framealpha=0.9)
    ax1.grid(True, alpha=0.2)
    ax1.set_ylim(bottom=0)

    ax2.set_ylabel('HTTP Error Rate (%)')
    ax2.legend(loc='upper left', fontsize=8, ncol=2, framealpha=0.9)
    ax2.grid(True, alpha=0.2)
    ax2.set_ylim(bottom=-2)

    ax3.set_ylabel('VUs')
    ax3.set_xlabel('Time (minutes)')
    ax3.grid(True, alpha=0.2)
    ax3.set_ylim(0, 320)

    plt.tight_layout()

    # Save
    if args.output:
        out_path = args.output
    else:
        out_path = os.path.join(DOCS_PUBLIC, 'ramp-300vu-timeseries.png')

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    plt.savefig(out_path, dpi=150, bbox_inches='tight')
    print(f"\nChart saved to: {out_path}")


if __name__ == '__main__':
    main()
