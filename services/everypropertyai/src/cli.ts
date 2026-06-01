#!/usr/bin/env node
import { Command } from "commander";
import { PropertyIQClient, PropertyIQError } from "./client.js";

const client = new PropertyIQClient();

function print(result: unknown) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

async function run(fn: () => Promise<unknown>) {
  try {
    print(await fn());
  } catch (err) {
    if (err instanceof PropertyIQError) {
      process.stderr.write(`Error: ${err.message}\n`);
      if (err.body) process.stderr.write(err.body.slice(0, 500) + "\n");
    } else {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exitCode = 1;
  }
}

const program = new Command();
program
  .name("everypropertyai")
  .description("Query PropertyIQ data (wraps the running PropertyIQ API). Outputs JSON.")
  .version("0.1.0");

program
  .command("search")
  .argument("<query...>", "free-text address")
  .description("Resolve an address to structured suggestions")
  .action((query: string[]) => run(() => client.suggestAddresses(query.join(" "))));

program
  .command("property")
  .argument("<address...>", "free-text address")
  .description("Full merged property profile (may trigger a live crawl if uncached)")
  .action((address: string[]) => run(() => client.fetchProperty(address.join(" "))));

program
  .command("comps")
  .description("Comparable sales in a suburb")
  .requiredOption("--suburb <suburb>")
  .option("--state <state>", "state", "VIC")
  .option("--beds <n>", "bedrooms", Number)
  .option("--baths <n>", "bathrooms", Number)
  .option("--type <type>", "property type")
  .action((o) =>
    run(() =>
      client.comparableSales({
        suburb: o.suburb,
        state: o.state,
        beds: o.beds,
        baths: o.baths,
        propertyType: o.type,
      }),
    ),
  );

program
  .command("sold")
  .description("Recent sold-sales feed for a suburb")
  .requiredOption("--suburb <suburb>")
  .option("--state <state>", "state", "VIC")
  .option("--min <n>", "min price", Number)
  .option("--max <n>", "max price", Number)
  .option("--since-days <n>", "lookback days", Number)
  .option("--limit <n>", "max rows", Number)
  .action((o) =>
    run(() =>
      client.soldSales({
        suburb: o.suburb,
        state: o.state,
        minPrice: o.min,
        maxPrice: o.max,
        sinceDays: o.sinceDays,
        limit: o.limit,
      }),
    ),
  );

program
  .command("enrich")
  .description("Location enrichment for a suburb")
  .requiredOption("--suburb <suburb>")
  .requiredOption("--state <state>")
  .requiredOption("--postcode <postcode>")
  .option("--address <address>")
  .action((o) =>
    run(() =>
      client.enrich({ suburb: o.suburb, state: o.state, postcode: o.postcode, address: o.address }),
    ),
  );

program
  .command("street")
  .argument("<query...>", "street + suburb")
  .description("All known addresses on a street")
  .action((query: string[]) => run(() => client.streetDetails(query.join(" "))));

program
  .command("cma")
  .argument("<address...>", "free-text address")
  .description("Generate a CMA pack (subject + comps + suburb sales + stats)")
  .action((address: string[]) =>
    run(() => client.cmaPack(address.join(" "), new Date().toISOString())),
  );

program
  .command("proposal")
  .argument("<address...>", "free-text address")
  .description("Presentation-ready property data for a proposal")
  .action((address: string[]) => run(() => client.proposalPropertyData(address.join(" "))));

program.parseAsync();
