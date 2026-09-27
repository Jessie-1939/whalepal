/**
 * 隐私审计（推送前必跑）：node scripts/privacy-audit.mjs
 *
 * 检查范围：
 *  1. 目录层：data/、reference/、node_modules/、dist/、out/ 不得被 git 跟踪；.gitignore 必须含 data/ 与 reference/；
 *  2. 当前树：跟踪文件不得包含 API Key、已知密钥片段、个人路径（C:\Users\…、D:\Program Files…）、
 *     本机用户名、业务空间专属域名、作者邮箱/QQ 号等；
 *  3. 历史：所有提交的 diff 同样扫一遍（防止"曾经提交过、后来删了"）。
 *
 * 注意：脚本内的敏感特征串故意拆开拼接，避免脚本自身触发告警。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const GIT_COMMON = ['-c', 'core.quotepath=false'];
const git = (...args) => execFileSync('git', [...GIT_COMMON, ...args], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const gitRaw = (...args) => execFileSync('git', [...GIT_COMMON, ...args], { maxBuffer: 64 * 1024 * 1024 });
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);

const violations = [];
const warnings = [];

// 1) 目录层
for (const f of tracked) {
  if (/^(data|reference|node_modules|dist|out)\//.test(f)) violations.push(`误跟踪目录文件: ${f}`);
}
const ignore = readFileSync('.gitignore', 'utf8');
if (!ignore.includes('data/')) violations.push('.gitignore 缺少 data/');
if (!ignore.includes('reference/')) violations.push('.gitignore 缺少 reference/');

// 2) 内容特征（敏感串拆开拼接，避免自触发）
const PATTERNS = [
  { re: new RegExp('sk-' + '[A-Za-z0-9._-]{6,}'), label: '疑似 API Key (sk-…)' },
  { re: new RegExp('PLPP' + 'HMR'), label: '已知密钥片段' },
  { re: new RegExp('DASHSCOPE' + '_API_KEY'), label: '环境变量名', warnOnly: true },
  { re: /C:\\Users\\[A-Za-z0-9._-]+/i, label: 'Windows 个人路径' },
  { re: /D:\\Program Files\\[^\s]/i, label: '本机绝对路径' },
  { re: new RegExp('208' + '76'), label: '本机用户名' },
  { re: new RegExp('maas\\.' + 'aliyuncs\\.com'), label: '业务空间专属域名' },
  { re: new RegExp('259' + '614060'), label: '作者邮箱/QQ 号' }
];

function scan(text, where) {
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) (p.warnOnly ? warnings : violations).push(`${where}: ${p.label} → ${String(m[0]).slice(0, 40)}`);
  }
}

// 当前树（逐文件读 blob，跳过二进制）
for (const f of tracked) {
  const buf = gitRaw('show', `HEAD:${f}`);
  const text = buf.toString('utf8');
  if (text.includes('\u0000')) continue; // 二进制跳过内容扫描
  scan(text, f);
}

// 历史（所有分支的 diff 文本）
scan(git('log', '--all', '-p', '--pretty=format:'), 'git 历史');

// 工作区未跟踪文件提示（避免把不该提交的文件 add 进来）
const untracked = git('status', '--porcelain')
  .split('\n')
  .filter((l) => l.startsWith('??'))
  .map((l) => l.slice(3));
if (untracked.length) warnings.push(`未跟踪文件 ${untracked.length} 个（提交前确认是否需要）: ${untracked.slice(0, 5).join(', ')}`);

const assets = tracked.filter((f) => f.startsWith('src/renderer/pet/assets/'));
console.log(`跟踪文件 ${tracked.length} 个（素材 ${assets.length} 个）`);

if (warnings.length) {
  console.log('提示：');
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
if (violations.length) {
  console.error('发现隐私风险，先处理再推送：');
  for (const v of violations) console.error(`  ✖ ${v}`);
  process.exit(1);
}
console.log('隐私审计通过：无密钥 / 无个人路径 / 无专属域名 / 数据目录未被跟踪 ✔');
