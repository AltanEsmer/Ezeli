// The owner commands. Run as: pnpm ezeli <command>
import { runHidden, runHide, runList, runShow } from './hide.ts'
import { runImport } from './import/command.ts'
import { runPerson } from './person.ts'

type Command = { summary: string; run: (args: string[]) => Promise<number> }

const commands: Record<string, Command> = {
  person: { summary: 'People and their personal links (person add --name <name> [--owner] | relink --name <name> | list)', run: runPerson },
  import: { summary: 'Load a chat export (WhatsApp iPhone layout or Discord; import <folder> --people <file> --timezone <zone> --chat <name> [--trial])', run: runImport },
  memory: { summary: 'List what a memory holds, numbered (memory <address>)', run: runList },
  hide: { summary: 'Hide a whole memory or one numbered item (hide <address> [number])', run: runHide },
  hidden: { summary: 'List what is hidden, numbered', run: runHidden },
  show: { summary: 'Stop hiding an item of that list (show <number>); it returns with the next import', run: runShow },
}

const [name, ...args] = process.argv.slice(2)
const command = name ? commands[name] : undefined

if (!command) {
  console.error('Usage: pnpm ezeli <command>')
  for (const [key, { summary }] of Object.entries(commands)) {
    console.error(`  ${key}  ${summary}`)
  }
  process.exit(1)
}

process.exit(await command.run(args))
