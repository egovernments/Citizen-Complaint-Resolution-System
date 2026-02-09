# Publishing Guide for @egovernments/digit-ui-module-cms

This document explains how to publish the CMS package to NPM using automated semantic versioning.

## Overview

- **Package Name**: `@egovernments/digit-ui-module-cms`
- **Repository**: https://github.com/egovernments/Citizen-Complaint-Resolution-System
- **Branch**: `master`
- **Registry**: NPM (https://registry.npmjs.org)
- **Automation**: Semantic-release with GitHub Actions

## Setup Requirements

### 1. NPM Token Setup

**Step 1: Create NPM Access Token**
1. Log in to [npmjs.com](https://www.npmjs.com)
2. Click your profile → **Access Tokens**
3. Click **Generate New Token** → **Classic Token**
4. Select **Automation** token type (required for CI/CD)
5. Copy the token (starts with `npm_...`)

**Step 2: Add Token to GitHub Secrets**
1. Go to https://github.com/egovernments/Citizen-Complaint-Resolution-System/settings/secrets/actions
2. Click **New repository secret**
3. Name: `NPM_TOKEN`
4. Value: Paste your NPM token
5. Click **Add secret**

**Step 3: Verify Organization Access**
If publishing scoped packages (`@egovernments/...`):

```bash
# Check your NPM organization membership
npm whoami
npm access ls-packages @egovernments

# Grant publish access (run as org owner if needed)
npm access grant read-write @egovernments:developers @egovernments/digit-ui-module-cms
```

### 2. Install Dependencies

Navigate to the package directory and install semantic-release dependencies:

```bash
cd frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr
yarn install
```

## How It Works

### Commit Message Format (Angular Convention)

The release type is determined by your commit message:

| Commit Message | Release Type | Version Change |
|----------------|--------------|----------------|
| `fix: resolve button issue` | Patch | 1.0.0 → 1.0.1 |
| `feat: add new feature` | Minor | 1.0.0 → 1.1.0 |
| `feat!: breaking change` | Major | 1.0.0 → 2.0.0 |
| `docs: update readme` | No release | No change |
| `chore: update deps` | No release | No change |

**Examples:**
```bash
# Patch release (bug fixes)
git commit -m "fix: resolve authentication timeout issue"

# Minor release (new features)
git commit -m "feat: add multi-language support for complaints"

# Major release (breaking changes)
git commit -m "feat!: redesign complaint submission API"

# No release
git commit -m "docs: update API documentation"
git commit -m "chore: update dependencies"
```

### Publishing Workflow

1. **Developer makes changes** and commits with proper message format
2. **PR is merged** to `master` branch
3. **GitHub Actions workflow triggers** (`.github/workflows/publish-cms-package.yml`)
4. **Workflow steps:**
   - Checks out code
   - Installs dependencies with Yarn
   - Builds the package
   - Runs semantic-release
5. **Semantic-release:**
   - Analyzes commit messages
   - Determines version bump
   - Updates package.json version
   - Generates CHANGELOG.md
   - Publishes to NPM
   - Creates GitHub release
   - Commits changes back with `[skip ci]`

## Publishing Your First Release

### Step 1: Make Your Changes

```bash
# Create a feature branch
git checkout -b feat/initial-cms-setup

# Make your changes
# ... (edit files)

# Commit with proper format
git add .
git commit -m "feat: initial CMS module setup with complaint management"
git push origin feat/initial-cms-setup
```

### Step 2: Create Pull Request

1. Go to https://github.com/egovernments/Citizen-Complaint-Resolution-System/pulls
2. Click **New Pull Request**
3. Set base branch to `master`
4. Add proper title and description
5. Request review

### Step 3: Merge to Master

Once approved, merge the PR to `master`. The workflow will automatically:
- Build the package
- Analyze commits
- Release version 1.0.0 (first release with `feat:` commit)
- Publish to NPM

### Step 4: Verify Release

1. **Check GitHub Actions**: https://github.com/egovernments/Citizen-Complaint-Resolution-System/actions
2. **Check NPM**: https://www.npmjs.com/package/@egovernments/digit-ui-module-cms
3. **Check GitHub Releases**: https://github.com/egovernments/Citizen-Complaint-Resolution-System/releases

## Testing Locally (Optional)

Test semantic-release without actually publishing:

```bash
# Navigate to package directory
cd frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr

# Install dependencies
yarn install

# Test release (dry-run, no actual publish)
NPM_TOKEN=your_npm_token yarn semantic-release --dry-run
```

## Files Created

This publishing setup includes:

1. **`.github/workflows/publish-cms-package.yml`**
   - GitHub Actions workflow for automated publishing
   - Triggers on push to `master` branch
   - Only runs when files in pgr package change

2. **`frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/.releaserc.json`**
   - Semantic-release configuration
   - Defines commit conventions and plugins
   - Configures changelog generation

3. **`frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/package.json`**
   - Updated with semantic-release dependencies
   - Version set to `0.0.0` (managed by semantic-release)
   - Added `publishConfig` for public scoped package

## Common Issues and Solutions

### ❌ Issue: "No release published"

**Cause**: No commits match the release rules (e.g., only `chore:` or `docs:` commits)

**Solution**: Use proper commit messages (`feat:`, `fix:`, etc.)

```bash
# Wrong (no release)
git commit -m "updated component"

# Correct (triggers release)
git commit -m "fix: update component styling"
```

### ❌ Issue: "ENEEDAUTH" error

**Cause**: NPM_TOKEN not configured or invalid

**Solution**:
1. Verify secret exists: GitHub repo → Settings → Secrets → Actions
2. Regenerate NPM token if expired
3. Ensure token type is "Automation"

### ❌ Issue: "You do not have permission to publish"

**Cause**: Not a member of @egovernments organization or no publish rights

**Solution**: Contact organization admin to grant publish access:
```bash
npm access grant read-write @egovernments:developers @egovernments/digit-ui-module-cms
```

### ❌ Issue: Workflow doesn't trigger

**Cause**: Changes not in the correct path

**Solution**: The workflow only triggers when files change in:
```
frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/**
```

### ❌ Issue: "Package name already exists"

**Cause**: Package already published with that version

**Solution**:
1. Check current version: `npm view @egovernments/digit-ui-module-cms version`
2. Ensure package.json version is set to `0.0.0` (let semantic-release manage it)

## Versioning Strategy

| Current Version | Commit Type | New Version |
|-----------------|-------------|-------------|
| 0.0.0 | `feat:` | 1.0.0 (first release) |
| 1.0.0 | `fix:` | 1.0.1 |
| 1.0.1 | `feat:` | 1.1.0 |
| 1.1.0 | `feat!:` | 2.0.0 |
| 1.1.0 | `fix:` + `feat:` | 1.2.0 (minor wins) |

## Best Practices

1. **Always use semantic commit messages**
   ```
   <type>: <short description>

   <optional longer description>

   <optional footer with breaking changes>
   ```

2. **Types to use:**
   - `feat:` - New features
   - `fix:` - Bug fixes
   - `perf:` - Performance improvements
   - `docs:` - Documentation only
   - `chore:` - Maintenance tasks
   - `refactor:` - Code refactoring
   - `test:` - Adding tests

3. **Breaking changes:**
   ```bash
   feat!: redesign API structure

   BREAKING CHANGE: API endpoints have been restructured
   ```

4. **Multiple commits:** If your PR has multiple commits, semantic-release analyzes all of them and picks the highest version bump

5. **Hotfixes:** Create a hotfix branch from master, commit with `fix:`, and merge back

## Monitoring and Maintenance

### Check Package Health

```bash
# View published versions
npm view @egovernments/digit-ui-module-cms versions

# View latest version info
npm view @egovernments/digit-ui-module-cms

# View downloads
npm view @egovernments/digit-ui-module-cms downloads
```

### Update Dependencies

Update semantic-release dependencies periodically:

```bash
cd frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr
yarn upgrade semantic-release @semantic-release/changelog @semantic-release/git
```

## Support

- **GitHub Issues**: https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues
- **NPM Package**: https://www.npmjs.com/package/@egovernments/digit-ui-module-cms
- **Semantic-release Docs**: https://semantic-release.gitbook.io/

## Quick Reference

```bash
# Install dependencies
yarn install

# Build locally
yarn build

# Test semantic-release (dry-run)
NPM_TOKEN=your_token yarn semantic-release --dry-run

# Check if package exists on NPM
npm view @egovernments/digit-ui-module-cms

# View workflow runs
# Visit: https://github.com/egovernments/Citizen-Complaint-Resolution-System/actions
```

---

**Note**: This package uses automated versioning. Never manually bump the version in `package.json` - semantic-release handles this automatically based on commit messages.
