/**
 * v137 Q&A gate test — isQuestionTask must route read-only questions to the
 * Q&A lane and keep real build work in the swarm.
 */
import { isQuestionTask, isTrivialTask } from '../src/lib/ai/swarm'

const QA = [
  'list the files in this project - answer in one short line only',
  'what does this project do',
  'explain the auth flow',
  'why is the server crashing?',
  'how do I deploy this?',
  'which files contain the admin panel?',
  'show me the README',
  'is there a database in this project',
  'describe the folder structure',
  'summarize what was built so far',
  'kothay database config ache?',
  'project er file gulo ki ki ase?',
  'what is 2+2',
  'check what the status endpoint returns',
]

const WORK = [
  'build a todo app',
  'build a todo app with admin panel',
  'add a testimonials section to the portfolio',
  'fix the bug in server.js',
  'make the header blue',
  'create a dark mode toggle',
  'delete the unused files',
  'update the readme with install steps',
  'can you fix the crash?',
  'could you add a login page',
  'please add a search bar',
  'design a landing page for my store',
  'portfolio site e testimonial section add kore dao',
  'ekta login page banao',
  'amake ekta ecommerce website banao',
  'refactor server.js into modules',
]

let fail = 0
for (const t of QA) {
  const r = isQuestionTask(t)
  if (!r) { fail++; console.log(`FAIL (should be Q&A): "${t}"`) }
  else console.log(`ok qa: "${t.slice(0, 60)}"`)
}
for (const t of WORK) {
  const r = isQuestionTask(t)
  if (r) { fail++; console.log(`FAIL (should be WORK): "${t}"`) }
  else console.log(`ok work: "${t.slice(0, 60)}"`)
}
console.log(fail === 0 ? '\nALL PASS ✅' : `\n${fail} FAILURES ❌`)
process.exit(fail === 0 ? 0 : 1)
