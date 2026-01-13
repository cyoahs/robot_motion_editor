import { defineConfig } from 'vite';
import { execSync } from 'child_process';

function getGitInfo() {
  try {
    const commitHash = execSync('git rev-parse HEAD').toString().trim();
    const commitShort = commitHash.substring(0, 8);
    const commitDate = execSync('git log -1 --format=%ci').toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();
    let tag = '';
    try {
      tag = execSync('git describe --tags --exact-match 2>/dev/null').toString().trim();
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
  // 检测托管环境
  console.log('🔍 检测环境变量:');
  console.log('  CF_PAGES:', process.env.CF_PAGES);
  console.log('  CF_PAGES_BRANCH:', process.env.CF_PAGES_BRANCH);
  console.log('  CF_PAGES_COMMIT_SHA:', process.env.CF_PAGES_COMMIT_SHA);
  console.log('  VERCEL:', process.env.VERCEL);
  console.log('  NETLIFY:', process.env.NETLIFY);
  console.log('  NODE_ENV:', process.env.NODE_ENV);
  
  // Cloudflare Pages 检测（多个环境变量）
  if (process.env.CF_PAGES || process.env.CF_PAGES_BRANCH || process.env.CF_PAGES_COMMIT_SHA) {
    console.log('✅ 检测到 Cloudflare Pages 环境');
    return 'Cloudflare Pages';
  } else if (process.env.VERCEL) {
    return 'Vercel';
  } else if (process.env.NETLIFY) {
    return 'Netlify';
  } else if (process.env.NODE_ENV === 'development') {
    return '本地开发环境';
  } else {
    return '本地部署';
  }
}

const gitInfo = getGitInfo();
const hostingEnv = getHostingEnvironment();

export default defineConfig({
  server: {
    port: 3000,
    open: true
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
