# Maintaining the personal fork

The fork keeps a small set of tested fixes while continuing to take updates from
[upstream Shepherdr](https://github.com/eliasstravik/shepherdr). Source changes and
installation are separate: fetching or merging never changes the running app.

## Remotes and branches

| Name | Purpose |
| --- | --- |
| `origin` | The personal GitHub fork; push fixes and review branches here |
| `upstream` | The original `eliasstravik/shepherdr` repository; fetch updates here |
| `main` | An unchanged copy of upstream `main`, with no personal fixes |
| `personal/stable` | Reviewed upstream code plus the personal fixes; install from here |
| `fix/...`, `sync/...` | A single fix or upstream update, reviewed before it reaches stable |

`git remote -v` shows the configured addresses. Local `main` tracks `upstream/main`;
`personal/stable` tracks `origin/personal/stable`. The default push remote is `origin`.
Always target the personal fork and base `personal/stable` when opening its pull
requests; the GitHub CLI may otherwise select the original repository.

## Make a fix with agents

Start from a clean, current `personal/stable` and create one `fix/...` branch. Give
one agent the implementation and regression test, and another the review. Use
separate worktrees for simultaneous fixes. Agents must read `AGENTS.md` and
[Develop](develop.md), edit shared sources in `core/` or `lib/`, and regenerate
copies with `python3 bin/sync-shared`.

Keep each fix as a focused commit so it can be offered upstream separately. Open a
pull request in the personal fork, targeting `personal/stable`. The **Check**
workflow runs for that target as well as `main`; merge after it passes and the
review is complete. Once upstream includes the same fix, reconcile it during the
next update instead of maintaining two competing implementations.

## Bring in upstream changes

Finish or save unrelated work first. From the existing checkout:

```bash
git fetch upstream --tags
git fetch origin
git switch personal/stable
git pull --ff-only origin personal/stable
git switch -c sync/upstream-YYYY-MM-DD
git merge upstream/main
```

Choose a unique name for the sync branch. To take a particular release instead of
all of upstream `main`, replace the last command with `git merge <release-tag>`.
Read the incoming changelog and diff before resolving conflicts. Preserve the
intent of the personal fixes and rerun their regression tests. If the merge needs
to be abandoned, `git merge --abort` returns to the pre-merge branch state. Do not
reset the personal branch to upstream or force-push it: that discards its fixes.

Push the sync branch to `origin` and open a pull request in the personal fork with
base `personal/stable`. Wait for **Check** and independent review, then merge. The
ordinary upstream `git pull --ff-only` instructions are for an unchanged branch;
a personal branch with additional commits needs this deliberate merge step.

Keep the separate upstream mirror current when convenient:

```bash
git switch main
git merge --ff-only upstream/main
git push origin main
```

Return to `personal/stable` before installing. Updating `main` alone does not bring
those changes into the personal branch.

## Check and install deliberately

Follow the full checks in [Develop](develop.md). For a fresh worktree, first run
`bun install --frozen-lockfile` and `bun web/build-plugins.ts`. Before a real update,
exercise the installer with `./install.sh --root <scratch-folder> --yes`; this
checks files without running a second Herdr window. Never change `HOME` or
`HERDR_APP_HOME` to test Herdr, and never run `herdr-app check` on
`shepherdr-settings`, whose initialization can update other machines.

After the stable pull request is merged, use the original installation checkout:

```bash
git switch personal/stable
git pull --ff-only origin personal/stable
git status --short
git rev-parse HEAD
./install.sh --dry-run --keys keep
./install.sh --keys keep
shepherdr doctor
```

Require a clean checkout and record the commit shown before installation. Inspect
the dry-run result, then install when ready. `shepherdr update` also installs from
the recorded source checkout, including whichever branch is checked out there;
it does not fetch or merge upstream. Keep that checkout on `personal/stable`
between updates and develop unrelated changes in worktrees.

The installer backs up replaced files and reports the backup location. Keep that
location with the installed commit. After installing, verify the affected feature
in the live app and confirm existing sessions and settings still behave correctly.
Do not edit installed copies as the long-term fix: a later update can replace them.
See [Install](install.md) for what the installer preserves and backs up.

For recovery, prefer a repair branch that reverts the offending fix, runs the
checks, and is merged into stable before reinstalling. A full older-version
reinstall also needs its data-migration compatibility checked; source history
alone is not a backup of tasks, settings, or other application data.
