/** Web/Server 及其直接 workspace 依赖的生产安全门禁。 */
import { spawnSync } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(
  pnpm,
  ['audit', '--prod', '--registry=https://registry.npmjs.org', '--json'],
  {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === 'win32',
  },
);

if (result.error) throw result.error;

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout);
  throw new Error('无法解析 pnpm audit JSON 输出');
}

const scopedPath = /^(?:apps__(?:server|web)|packages__(?:api|adapters|assets|db-adapter|editor-core|editor-web|services|shared|sync-client|sync-engine|ui)|\.)>/;
const blocking = Object.values(report.advisories ?? {}).flatMap((advisory) => {
  if (!['critical', 'high'].includes(advisory.severity)) return [];
  const paths = (advisory.findings?.paths ?? []).filter((path) => scopedPath.test(path));
  return paths.length === 0 ? [] : [{ advisory, paths }];
});

if (blocking.length > 0) {
  for (const { advisory, paths } of blocking) {
    process.stderr.write(`[${advisory.severity}] ${advisory.module_name}: ${advisory.title}\n`);
    for (const path of paths) process.stderr.write(`  ${path}\n`);
  }
  process.exitCode = 1;
} else {
  const full = report.metadata?.vulnerabilities ?? {};
  process.stdout.write(
    `Web/Server production Critical/High: 0; full workspace Critical=${full.critical ?? 0}, High=${full.high ?? 0}\n`,
  );
}
