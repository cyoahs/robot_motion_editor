import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';

function git(...args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

function getGitInfo() {
  try {
    const commitHash = git('rev-parse', 'HEAD');
    const commitShort = commitHash.substring(0, 8);
    const commitDate = git('log', '-1', '--format=%ci');
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    let tag = '';
    try {
      tag = git('describe', '--tags', '--exact-match');
    } catch (e) {
      // No tag on current commit
    }
    return { commitHash, commitShort, commitDate, branch, tag };
  } catch (e) {
    console.warn('Failed to get git info:', e.message);
    return { commitHash: 'unknown', commitShort: 'unknown', commitDate: '', branch: '', tag: '' };
  }
}

function getHostingEnvironment() {
  const env = process.env || {};

  console.log('🔍 检测环境变量:');
  Object.keys(env)
    .filter(k => k.startsWith('CLOUDFLARE') || k.startsWith('CF_'))
    .forEach(k => console.log(`  ${k}:`, env[k]));

  const isCloudflare = Object.keys(env).some(
    key => key.startsWith('CLOUDFLARE') || key.startsWith('CF_')
  );

  if (isCloudflare) {
    console.log('✅ 检测到 Cloudflare 环境');
    return 'Cloudflare';
  }

  if (env.VERCEL) return 'Vercel';
  if (env.NETLIFY) return 'Netlify';
  if (env.NODE_ENV === 'development') return '本地开发环境';

  return '本地 / 其他环境';
}

const gitInfo = getGitInfo();
const hostingEnv = getHostingEnvironment();

export default defineConfig({
  server: {
    port: 3000,
    open: !process.env.CI,
    watch: {
      usePolling: true,
      interval: 1000
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  },
  define: {
    '__GIT_COMMIT_SHORT__': JSON.stringify(gitInfo.commitShort),
    '__GIT_COMMIT_HASH__': JSON.stringify(gitInfo.commitHash),
    '__GIT_COMMIT_DATE__': JSON.stringify(gitInfo.commitDate),
    '__GIT_BRANCH__': JSON.stringify(gitInfo.branch),
    '__GIT_TAG__': JSON.stringify(gitInfo.tag),
    '__HOSTING_ENV__': JSON.stringify(hostingEnv)
  }
});
