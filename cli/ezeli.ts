// The owner commands. Run as: pnpm ezeli <command>
import { runImport } from './import/command.ts'
import { runPerson } from './person.ts'

type Command = { summary: string; run: (args: string[]) => Promise<number> }

const commands: Record<string, Command> = {
  person: { summary: 'People and their personal links (person add --name <name> [--owner] | relink --name <name> | list)', run: runPerson },
  import: { summary: 'Load a chat export (WhatsApp iPhone layout or Discord; import <folder> --people <file> --timezone <zone> --chat <name> [--trial])', run: runImport },
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
