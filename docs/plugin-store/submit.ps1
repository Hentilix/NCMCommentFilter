# Run only after reviewing the local changes and signing in with gh auth login.
# Every failed external command stops this script. No force-push or automatic merge.
$ErrorActionPreference = 'Stop'
function Invoke-Checked {
    $program = $args[0]
    $commandArgs = @($args | Select-Object -Skip 1)
    & $program @commandArgs
    if ($LASTEXITCODE -ne 0) { throw "$program failed (exit $LASTEXITCODE). Stop and share the error with Codex." }
}

$pluginRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$storePath = Join-Path $pluginRoot '.local\BetterNCM-Plugins'
$branch = 'codex/add-ncm-comment-filter'
Push-Location -LiteralPath $pluginRoot
try {
    $login = Invoke-Checked gh api user --jq .login
    if ($login -ne 'Hentilix') { throw 'Sign in to GitHub as Hentilix before continuing.' }
    $repo = (Invoke-Checked gh repo view Hentilix/NCMCommentFilter --json 'isPrivate,hasIssuesEnabled') | ConvertFrom-Json
    if ($repo.isPrivate -or -not $repo.hasIssuesEnabled) { throw 'The source repository must be public with Issues enabled. Ask Codex before changing settings.' }
    if ((Invoke-Checked git branch --show-current) -ne 'main') { throw 'Expected the local plugin branch to be main.' }
    if ((Invoke-Checked git remote get-url origin) -ne 'https://github.com/Hentilix/NCMCommentFilter.git') { throw 'Unexpected origin URL. Stop and ask Codex.' }
    if (Invoke-Checked git diff --cached --name-only) { throw 'There are already staged changes. Stop and ask Codex before combining them.' }
    $reuseStore = Test-Path -LiteralPath $storePath
    if ($reuseStore) {
        $checkoutRoot = Invoke-Checked git -C $storePath rev-parse --show-toplevel
        if ([System.IO.Path]::GetFullPath($checkoutRoot) -ne [System.IO.Path]::GetFullPath($storePath)) { throw 'The existing store directory is not a separate repository. Stop and ask Codex.' }
        if ((Invoke-Checked git -C $storePath remote get-url upstream) -ne 'https://github.com/BetterNCM/BetterNCM-Plugins.git') { throw 'The existing store checkout has an unexpected upstream. Stop and ask Codex.' }
        if ((Invoke-Checked git -C $storePath branch --show-current) -ne 'master') { throw 'The existing store checkout is not on master. Stop and ask Codex.' }
        if (Invoke-Checked git -C $storePath status --porcelain) { throw 'The existing store checkout has local changes. Stop and ask Codex.' }
        if ((Invoke-Checked git -C $storePath rev-parse HEAD) -ne (Invoke-Checked git -C $storePath rev-parse upstream/master)) { throw 'The existing store checkout has local commits. Stop and ask Codex.' }
    }
    $null = Invoke-Checked git var GIT_AUTHOR_IDENT
    Invoke-Checked git fetch origin main
    Invoke-Checked git merge-base --is-ancestor origin/main HEAD

    $existing = Invoke-Checked gh pr list --repo BetterNCM/BetterNCM-Plugins --head "Hentilix:$branch" --state open --json url --jq '.[].url'
    if ($existing) { throw "A listing PR already exists: $existing" }

    # Prepare a separate checkout of the current official store branch.
    if (-not $reuseStore) {
        Invoke-Checked git clone --depth 1 --filter=blob:none --sparse --origin upstream --branch master https://github.com/BetterNCM/BetterNCM-Plugins.git $storePath
    }
    Invoke-Checked git -C $storePath sparse-checkout set plugins-list
    $storeEntries = Get-ChildItem -LiteralPath (Join-Path $storePath 'plugins-list') -Filter '*.json'
    foreach ($entry in $storeEntries) {
        $metadata = Get-Content -LiteralPath $entry.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($metadata.name -eq 'NCMCommentFilter' -or $metadata.slug -eq 'ncm-comment-filter' -or $metadata.repo -eq 'Hentilix/NCMCommentFilter') {
            throw "The store already contains a matching plugin: $($entry.Name). Stop and ask Codex."
        }
    }
    $storePaths = Invoke-Checked git -C $storePath ls-tree -d --name-only HEAD plugins-data/ncm-comment-filter plugins-data/ncmcommentfilter
    if ($storePaths) { throw 'The store already contains this plugin ID. Stop and ask Codex.' }

    # Publish the prepared plugin source and package first.
    Invoke-Checked git add -- main.js manifest.json preview.jpg .betterncm-ignore package.json package-lock.json README.md scripts/build_plugin.py dist/ncm-comment-filter.plugin docs/plugin-store
    Invoke-Checked git diff --cached --check
    Invoke-Checked git commit -m 'Prepare NCMCommentFilter 0.2.4 for the plugin store'
    Invoke-Checked git push origin main

    # Create the store contribution under the user's fork, then open the PR.
    Invoke-Checked gh repo fork BetterNCM/BetterNCM-Plugins --clone=false --remote=false
    Invoke-Checked git -C $storePath remote add origin https://github.com/Hentilix/BetterNCM-Plugins.git
    Invoke-Checked git -C $storePath switch -c $branch
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'NCMCommentFilter.json') -Destination (Join-Path $storePath 'plugins-list\NCMCommentFilter.json')
    Invoke-Checked git -C $storePath add -- plugins-list/NCMCommentFilter.json
    Invoke-Checked git -C $storePath commit -m 'Add NCMCommentFilter'
    Invoke-Checked git -C $storePath push -u origin $branch
    Invoke-Checked gh pr create --repo BetterNCM/BetterNCM-Plugins --base master --head "Hentilix:$branch" --title 'Add NCMCommentFilter' --body-file (Join-Path $PSScriptRoot 'pr-body.md')
} finally {
    Pop-Location
}
