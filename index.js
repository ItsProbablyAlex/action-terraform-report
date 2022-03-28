/* eslint-disable camelcase */

// packages
const core = require('@actions/core')
const github = require('@actions/github')
const unidiff = require('@ahmadnassri/terraform-unidiff')
const { promises: { readFile } } = require('fs')

// parse inputs
const inputs = {
  diff: core.getInput('show-diff'),
  plan: core.getInput('show-plan'),
  text: core.getInput('terraform-text'),
  json: core.getInput('terraform-json'),
  token: core.getInput('github-token'),
  removeStaleReports: core.getInput('remove-stale-reports')
}

// extract relevant variables
const { runId, payload: { pull_request } } = github.context

// build report content
const AUTOMATED_REPORT_TITLE = ":robot: Terraform Report"
const AUTOMATED_REPORT_FOOTER = `This comment was generated by [Terraform Pull Request Report Generator](https://github.com/ahmadnassri/action-terraform-report) - action run [#${runId}](https://github.com/${github.context.repo.owner}/${github.context.repo.repo}/actions/runs/${runId}) - commit ${github.context.sha}`

// exit early
if (!inputs.text || !inputs.json || !inputs.token) {
  core.error('Missing required inputs')
  process.exit(1)
}

// exit early
if (pull_request.state !== 'open') {
  core.warning('action triggered on a closed pull request')
  process.exit(0)
}

// error handler
function errorHandler (err) {
  console.error(err)
  core.error(`Unhandled error: ${err}`)
  process.exit(1)
}

// catch errors and exit
process.on('unhandledRejection', errorHandler)
process.on('uncaughtException', errorHandler)

const octokit = github.getOctokit(inputs.token)

const removeStaleReports = async () => {
  // get issue comments
  const {data: comments} = await octokit.issues.listComments({
    ...github.context.repo,
    issue_number: pull_request.number,
  })

  // get action comments
  const actionComments = comments.filter(c => c.body.includes(AUTOMATED_REPORT_TITLE) && !c.body.includes(AUTOMATED_REPORT_FOOTER))

  // remove existing comments
  for (var i = 0; i < actionComments.length; i++) {
    try {
      await octokit.issues.deleteComment({
        ...github.context.repo,
        issue_number: pull_request.number,
        comment_id: actionComments[i]["id"]
      })
    } catch(e) {
      console.warn(`Could not delete comment: ${actionComments[i]["id"]}`)
    }
  }
}

async function main () {
  // load terraform files
  const text = await readFile(inputs.text)
  const json = await readFile(inputs.json)

  // load terraform plan JSON
  const data = JSON.parse(json)

  // process file
  const { summary, patches } = unidiff(data)

  const diff = patches.map(patch => `\`\`\`diff\n${patch}\n\`\`\``).join('\n\n')

  let body = `
### ${AUTOMATED_REPORT_TITLE}
---
##### Summary: \`${summary.create}\` to add, \`${summary.update}\` to change, \`${summary.delete}\` to destroy
`
  if (inputs.plan === 'true') {
    body += `
<details><summary>Show Plan</summary>

\`\`\`terraform
${text}
\`\`\`
</details>
`
  }

  if (inputs.diff === 'true') {
    body += `
<details><summary>Show Diff</summary>

${diff}
</details>
`
  }

  body += `

---
${AUTOMATED_REPORT_FOOTER}
`

  if (inputs.removeStaleReports === 'true') {
    removeStaleReports()
  }

  // update PR
  await octokit.issues.createComment({
    ...github.context.repo,
    issue_number: pull_request.number,
    body
  })
}

main()
