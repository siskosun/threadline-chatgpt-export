"""Build cloud-review candidates, not a production release. Python 3.12+, standard library only."""
import hashlib
import json
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST = ROOT / 'dist'
INCLUDE = ['src', 'workspace', 'icons', 'lib', 'popup']
base = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
assert base['manifest_version'] == 3
assert '<all_urls>' not in json.dumps(base)
assert base['background']['service_worker'] == 'src/tl-service.js'
assert 'default_popup' not in base['action']
try:
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
except (OSError, subprocess.CalledProcessError):
    commit = os.environ.get('SOURCE_COMMIT', 'uncommitted-cloud-workspace')

# dist is generated only; stale upstream installers must never enter new packages.
shutil.rmtree(DIST, ignore_errors=True)
DIST.mkdir()

def package_zip(root, target, prefix=''):
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, allowZip64=True, compresslevel=6) as z:
        for p in sorted(root.rglob('*')):
            if not p.is_file():
                continue
            info = zipfile.ZipInfo(prefix + p.relative_to(root).as_posix(), (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            z.writestr(info, p.read_bytes())

for name in ['chrome', 'chromium', 'edge']:
    out = DIST / name
    out.mkdir()
    for folder in INCLUDE:
        shutil.copytree(ROOT / folder, out / folder)
    for file in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
        shutil.copyfile(ROOT / file, out / file)
    (out / 'manifest.json').write_text(json.dumps(base, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    hashes = {p.relative_to(out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.rglob('*')) if p.is_file()}
    (out / 'BUILD_INFO.json').write_text(json.dumps({'schema': 1, 'source_commit': commit, 'version': base['version'], 'status': 'candidate_real_account_acceptance_pending', 'files': hashes}, indent=2) + '\n', encoding='utf-8')
    package_zip(out, DIST / f'threadline-{name}-{base["version"]}-candidate.zip')
    # Preserve the old CI filename only as an identical candidate package; no store submission is performed.
    if name == 'edge':
        package_zip(out, DIST / f'chatgpt-export-edge-addons-{base["version"]}.zip')
    print('BUILT', name, base['version'], commit)

sums = []
for p in sorted(DIST.glob('*.zip')):
    with zipfile.ZipFile(p) as z:
        assert z.testzip() is None, p
        m = json.loads(z.read('manifest.json'))
        assert m['background']['service_worker'] in z.namelist()
        assert 'workspace/index.html' in z.namelist()
        assert 'LICENSE' in z.namelist() and 'THIRD_PARTY_NOTICES.md' in z.namelist()
        for content in m['content_scripts']:
            assert all(x in z.namelist() for x in content['js'])
    sums.append(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name)
(DIST / 'SHA256SUMS').write_text('\n'.join(sums) + '\n', encoding='utf-8')
print('PACKAGE_VERIFICATION_PASSED', len(sums))
