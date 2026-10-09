"""Export the pinned API without starting its lifespan or connecting to services.

Usage: /path/to/api/.venv/bin/python scripts/export-api.py /path/to/api/repo
The API environment supplies its pinned dependencies; content comes from git archive.
"""
import ast
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
baseline = json.loads((ROOT / 'baselines/api.json').read_text())
repo = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='cscheap-api-export-') as temp:
    archive = subprocess.check_output(['git', '-C', str(repo), 'archive', baseline['commit']])
    import io
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(temp, filter='data')
    snapshot = Path(temp)
    tree = ast.parse((snapshot / 'apps/api/tests/conftest.py').read_text())
    placeholders = next(ast.literal_eval(node.value) for node in tree.body
                        if isinstance(node, ast.Assign) and any(
                            isinstance(t, ast.Name) and t.id == '_PLACEHOLDER_ENV'
                            for t in node.targets))
    os.environ.clear()
    os.environ.update(placeholders)
    sys.path.insert(0, str(snapshot / 'apps/api'))
    def forbidden(*args, **kwargs):
        raise RuntimeError('Network is disabled for OpenAPI export')
    socket.socket.connect = forbidden
    socket.create_connection = forbidden
    from cscheap_api.main import create_app
    from cscheap_api.settings import Settings
    from cscheap_api.endpoint_meta import localized_openapi
    app = create_app(Settings(_env_file=None))
    out = ROOT / '.cache/openapi'
    out.mkdir(parents=True, exist_ok=True)
    for locale in ('en', 'zh-CN', 'ru'):
        schema = localized_openapi(app, locale)
        (out / f'{locale}.json').write_text(json.dumps(schema, ensure_ascii=False, indent=2) + '\n')
    (out / 'provenance.json').write_text(json.dumps({
        'repository': baseline['repository'], 'commit': baseline['commit'],
        'method': 'git-archive/create_app/localized_openapi/no-lifespan/no-network',
    }, indent=2) + '\n')
print('Exported fixed API revision to .cache/openapi; run npm run api:generate.')
