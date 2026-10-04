#!/usr/bin/env python3
"""Compare Playwright --list reports; discovery never implies a passing test."""
import json
from pathlib import Path
import re
import subprocess

root = Path(__file__).resolve().parents[1]
evidence = root / 'docs/identity-evidence'
revision = '171e5fe1a'

def inventory(name):
    report = json.loads((evidence / name).read_text())
    if report.get('errors'):
        raise SystemExit('Discovery errors in ' + name)
    files = {}
    def walk(suites):
        for suite in suites:
            for spec in suite.get('specs', []):
                files.setdefault(spec['file'], []).append(spec['title'])
            walk(suite.get('suites', []))
    walk(report['suites'])
    return files

baseline = inventory('baseline-all-list.json')
current = inventory('final-all-list.json')
changed_helpers = {'utils/auth.ts', 'utils/citizen-login.ts', 'utils/citizen-provision.ts',
                   'utils/configurator-auth.ts', 'utils/launch-fixes/api.ts', 'utils/launch-fixes/ui.ts', 'utils/manage/api.ts'}
texts = {str(p.relative_to(root / 'tests')): p.read_text() for p in (root / 'tests').rglob('*.ts')}
imports = {}
for file, source in texts.items():
    dependencies = []
    for relative in re.findall(r'''from\s*['"](\.[^'"]+)['"]''', source):
        path = (root / 'tests' / file).parent / relative
        for resolved in [Path(str(path) + '.ts'), path / 'index.ts']:
            if resolved.exists():
                dependencies.append(str(resolved.resolve().relative_to(root / 'tests')))
                break
    imports[file] = dependencies

def transitive(file, seen=None):
    seen = set() if seen is None else seen
    if file in seen:
        return seen
    seen.add(file)
    for dependency in imports.get(file, []):
        transitive(dependency, seen)
    return seen

rows = []
for file, old_cases in sorted(baseline.items()):
    new_cases = current.get(file, [])
    if len(new_cases) < len(old_cases):
        raise SystemExit('Case count fell in ' + file)
    rows.append({'file': file, 'baselineCount': len(old_cases), 'currentCount': len(new_cases),
                 'migratedHelperDependencies': sorted(transitive(file) & changed_helpers),
                 'replacementMapping': [{'before': before, 'after': new_cases[index]} for index, before in enumerate(old_cases)]})
summary = {'baselineRevision': revision, 'discoveryOnly': True, 'baselinePassRate': None, 'currentPassRate': None,
           'baseline': {'cases': sum(map(len, baseline.values())), 'files': len(baseline)},
           'current': {'cases': sum(map(len, current.values())), 'files': len(current)},
           'files': rows}
(evidence / 'replacement-map.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: summary[key] for key in ['baselineRevision', 'discoveryOnly', 'baselinePassRate', 'currentPassRate', 'baseline', 'current']}, indent=2))
