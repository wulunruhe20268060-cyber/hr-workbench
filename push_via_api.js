const { execSync } = require('child_process');
const fs = require('fs');
const https = require('https');

const TOKEN = process.argv[2];
const REPO = 'wulunruhe20268060-cyber/hr-workbench';
const BRANCH = 'master';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path: '/repos/' + REPO + path,
      method,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'User-Agent': 'workbuddy-deploy',
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      }
    };
    const r = https.request(options, (res) => {
      let out = '';
      res.on('data', (c) => out += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(out); } catch (e) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error('HTTP ' + res.statusCode + ' ' + (parsed && parsed.message || out)));
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function b64(buf) {
  return buf.toString('base64');
}

async function main() {
  const commitSha = execSync('git rev-parse HEAD').toString().trim();
  console.log('local HEAD:', commitSha);

  const remoteRef = await req('GET', '/git/refs/heads/' + BRANCH);
  const parentSha = remoteRef.object.sha;
  console.log('remote parent:', parentSha);

  const files = execSync('git -c core.quotepath=false ls-tree -r HEAD --name-only').toString().trim().split('\n').filter(Boolean);
  console.log('files:', files.length);

  const entries = [];
  for (const f of files) {
    const content = fs.readFileSync(f);
    const blob = await req('POST', '/git/blobs', { content: b64(content), encoding: 'base64' });
    entries.push({ path: f, mode: '100644', type: 'blob', sha: blob.sha });
    process.stdout.write('.');
  }
  console.log('\nblobs created');

  const tree = await req('POST', '/git/trees', { tree: entries });
  console.log('tree created:', tree.sha);

  const commitMsg = execSync('git log -1 --pretty=%B').toString().trim();
  const commit = await req('POST', '/git/commits', {
    message: commitMsg,
    tree: tree.sha,
    parents: [parentSha]
  });
  console.log('commit created:', commit.sha);

  await req('PATCH', '/git/refs/heads/' + BRANCH, { sha: commit.sha, force: false });
  console.log('REF UPDATED ->', commit.sha);
  console.log('PUSH_VIA_API_OK');
}

main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });
