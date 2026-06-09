---
layout: home

hero:
  name: DIGIT Load Tests
  text: 544K txn/day at 1M records
  tagline: "Load tested the DIGIT PGR complaint lifecycle. Found 3 critical database bugs. Fixed them for a 9.4x throughput recovery."
  actions:
    - theme: brand
      text: Executive Summary
      link: /executive-summary
    - theme: alt
      text: Detailed Findings
      link: /findings

features:
  - title: "Executive Summary"
    details: Key numbers, what we found, what to do about it. Start here.
    link: /executive-summary
  - title: "Detailed Findings"
    details: Database bugs with EXPLAIN plans, SQL fixes, degradation curves, and the recommended upstream fix.
    link: /findings
  - title: "Architecture"
    details: How the tests are designed — PGR lifecycle, scenario types, CPU profiling, infrastructure.
    link: /architecture
  - title: "Setup & Running"
    details: Machine provisioning, k6 configuration, running tests, and troubleshooting.
    link: /setup
---
