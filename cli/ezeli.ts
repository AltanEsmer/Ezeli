// The owner commands. Run as: pnpm ezeli <command>
type Command = { summary: string; run: (args: string[]) => Promise<number> }

const commands: Record<string, Command> = {}

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
