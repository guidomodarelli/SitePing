import { Command } from "commander";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { statusCommand } from "./commands/status.js";
import { syncCommand } from "./commands/sync.js";

const program = new Command()
  .name("beezping")
  .description("CLI to configure @beezping/* in your project")
  .version("0.7.1"); // x-release-please-version

program
  .command("init")
  .description("Set up the Prisma schema and API route in your project")
  .action(initCommand)
  .addHelpText("after", "\n  Examples:\n    $ beezping init");

program
  .command("sync")
  .description("Sync the Prisma schema (non-interactive, CI-friendly)")
  .option("--schema <path>", "Path to the schema.prisma file")
  .action(syncCommand)
  .addHelpText("after", "\n  Examples:\n    $ beezping sync\n    $ beezping sync --schema prisma/schema.prisma");

program
  .command("status")
  .description("Full diagnostic of the Beezping integration")
  .option("--schema <path>", "Path to the schema.prisma file")
  .action(statusCommand)
  .addHelpText("after", "\n  Examples:\n    $ beezping status\n    $ beezping status --schema prisma/schema.prisma");

program
  .command("doctor")
  .description("Test the connection to the Beezping API")
  .option("--url <url>", "Site base URL; a path in it prefixes --endpoint (default: http://localhost:3000)")
  .option("--endpoint <path>", "Endpoint path (default: /api/beezping)")
  .option("--api-key <key>", "Bearer token for endpoints configured with apiKey")
  .action(doctorCommand)
  .addHelpText(
    "after",
    "\n  Examples:\n    $ beezping doctor\n    $ beezping doctor --url https://staging.example.com --endpoint /api/feedback\n    $ beezping doctor --url https://app.example.com --api-key $BEEZPING_API_KEY",
  );

program.parse();
