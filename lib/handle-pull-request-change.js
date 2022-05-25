module.exports = handlePullRequestChange

const isSemanticMessage = require('./is-semantic-message')

const DEFAULT_OPTS = {
  enabled: true,
  titleOnly: false,
  commitsOnly: false,
  titleAndCommits: false,
  anyCommit: false,
  scopes: null,
  types: null,
  allowMergeCommits: false,
  allowRevertCommits: false
}

async function getCommits (context) {
  const commits = await context.octokit.pulls.listCommits(context.repo({
    pull_number: context.payload.pull_request.number
  }))
  return commits.data
}

async function commitsAreSemantic (commits, scopes, types, allCommits = false, allowMergeCommits, allowRevertCommits) {
  return commits
    .map(element => element.commit)[allCommits ? 'every' : 'some'](commit => isSemanticMessage(commit.message, scopes, types, allowMergeCommits, allowRevertCommits))
}

async function handlePullRequestChange (context) {
  // Adds a status check to merge queue in expectation of check being applied already on PR layer
  if (context.payload.pull_request == null) {
    if (context.payload.ref.startsWith("refs/heads/gh-readonly-queue/main/")) {
      const status = {
        sha: context.payload.after,
        state: "success",
        target_url: 'https://github.com/devterm-its/semantic-pull-requests',
        description: "skipped as part of merge queue",
        context: 'Semantic Pull Request'
      }
      const result = await context.octokit.repos.createCommitStatus(context.repo(status))
      return result
    }
    return
  }

  const { title, head } = context.payload.pull_request
  const userConfig = await context.config('semantic.yml', {})
  const isVanillaConfig = Object.keys(userConfig).length === 0
  const {
    enabled,
    titleOnly,
    commitsOnly,
    titleAndCommits,
    anyCommit,
    scopes,
    types,
    allowMergeCommits,
    allowRevertCommits
  } = Object.assign({}, DEFAULT_OPTS, userConfig)

  const hasSemanticTitle = isSemanticMessage(title, scopes, types)
  const commits = await getCommits(context)
  const hasSemanticCommits = await commitsAreSemantic(commits, scopes, types, (commitsOnly || titleAndCommits) && !anyCommit, allowMergeCommits, allowRevertCommits)
  const nonMergeCommits = commits.filter(element => !element.commit.message.startsWith('Merge'))

  let isSemantic

  if (!enabled) {
    isSemantic = true
  } else if (titleOnly) {
    isSemantic = hasSemanticTitle
  } else if (commitsOnly) {
    isSemantic = hasSemanticCommits
  } else if (titleAndCommits) {
    isSemantic = hasSemanticTitle && hasSemanticCommits
  } else if (isVanillaConfig && nonMergeCommits.length === 1) {
    // Watch out for cases where there's only commit and it's not semantic.
    // GitHub won't squash PRs that have only one commit.
    isSemantic = hasSemanticCommits
  } else {
    isSemantic = hasSemanticTitle || hasSemanticCommits
  }

  const state = isSemantic ? 'success' : 'failure'

  function getDescription () {
    if (!enabled) return 'skipped; check disabled in semantic.yml config'
    if (!isSemantic && isVanillaConfig && nonMergeCommits.length === 1) return 'PR has only one non-merge commit and it\'s not semantic; add another commit before squashing'
    if (isSemantic && titleAndCommits) return 'ready to be merged, squashed or rebased'
    if (!isSemantic && titleAndCommits) return 'add a semantic commit AND PR title'
    if (hasSemanticTitle && !commitsOnly) return 'ready to be squashed'
    if (hasSemanticCommits && !titleOnly) return 'ready to be merged or rebased'
    if (titleOnly) return 'add a semantic PR title'
    if (commitsOnly && anyCommit) return 'add a semantic commit'
    if (commitsOnly) return 'make sure every commit is semantic'
    return 'add a semantic commit or PR title'
  }

  const status = {
    sha: head.sha,
    state,
    target_url: 'https://github.com/devterm-its/semantic-pull-requests',
    description: getDescription(),
    context: 'Semantic Pull Request'
  }
  const result = await context.octokit.repos.createCommitStatus(context.repo(status))
  return result
}
