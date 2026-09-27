import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'test', 'scripts'];
const files = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (['.js', '.mjs', '.cjs'].includes(extname(name))) files.push(full);
  }
}

for (const r of roots) {
  try {
    walk(r);
  } catch {
    // 目录不存在时跳过
  }
}

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
    console.log('ok   ' + f);
  } catch (err) {
    failed++;
    console.error('FAIL ' + f + '\n' + String(err.stderr || err.message || err));
  }
}

if (failed) {
  console.error(`\n${failed} file(s) failed syntax check`);
  process.exit(1);
}
console.log(`\n${files.length} file(s) passed syntax check`);
