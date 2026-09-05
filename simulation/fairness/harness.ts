/**
 * A minimal check harness.
 *
 * Deliberately not a test framework: these are simulations that report
 * measured quantities, and the report is as much the output as the pass/fail
 * verdict. A failure prints what was expected, what was measured, and the seed
 * needed to reproduce it.
 */

export interface CheckReport {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

const reports: CheckReport[] = [];

const GREEN = "[32m";
const RED = "[31m";
const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

export function section(title: string): void {
  process.stdout.write(`\n${BOLD}${title}${RESET}\n`);
}

export function check(name: string, passed: boolean, detail: string): void {
  reports.push({ name, passed, detail });
  const mark = passed ? `${GREEN}pass${RESET}` : `${RED}FAIL${RESET}`;
  process.stdout.write(`  ${mark}  ${name}\n${DIM}        ${detail}${RESET}\n`);
}

/** Asserts a measured ratio sits within `tolerance` of its expected value. */
export function checkRatio(
  name: string,
  measured: number,
  expected: number,
  tolerance: number,
): void {
  const delta = Math.abs(measured - expected);
  check(
    name,
    delta <= tolerance,
    `measured ${measured.toFixed(6)}, expected ${expected.toFixed(6)}, ` +
      `delta ${delta.toFixed(6)}, tolerance ${tolerance.toFixed(6)}`,
  );
}

/**
 * Prints the summary and sets the exit code.
 *
 * Exits non-zero on any failure so the simulation can gate a commit or a CI
 * step without extra wiring.
 */
export function summarize(): void {
  const failed = reports.filter((report) => !report.passed);
  const total = reports.length;

  process.stdout.write(`\n${BOLD}${"─".repeat(64)}${RESET}\n`);
  if (failed.length === 0) {
    process.stdout.write(`${GREEN}${BOLD}All ${total} checks passed.${RESET}\n\n`);
    return;
  }

  process.stdout.write(
    `${RED}${BOLD}${failed.length} of ${total} checks failed:${RESET}\n`,
  );
  for (const report of failed) {
    process.stdout.write(`${RED}  · ${report.name}${RESET}\n`);
  }
  process.stdout.write("\n");
  process.exitCode = 1;
}
