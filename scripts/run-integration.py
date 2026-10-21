# Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later
"""Run HTTP parity checks against a fresh, owned local Wrangler process."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import requests

root = Path(__file__).resolve().parent.parent
with socket.socket() as s:
    s.bind(('127.0.0.1',0))
    port=s.getsockname()[1]
env=dict(os.environ, API_URL=f'http://127.0.0.1:{port}/api/analyze', HEALTH_URL=f'http://127.0.0.1:{port}/api/health')
with tempfile.TemporaryFile(mode='w+',encoding='utf8') as log:
    server=subprocess.Popen(['node',str(root/'node_modules/wrangler/bin/wrangler.js'),'pages','dev','public','--ip','127.0.0.1','--port',str(port),'--show-interactive-dev-session=false'],cwd=root,stdout=log,stderr=subprocess.STDOUT,start_new_session=os.name!='nt',creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    code=1
    try:
        for _ in range(180):
            if server.poll() is not None: raise RuntimeError('Wrangler exited before readiness')
            try:
                health=requests.get(env['HEALTH_URL'],timeout=.4)
                if health.status_code==200 and health.json().get('version')=='1.1.0':break
            except requests.RequestException:pass
            time.sleep(.5)
        else:raise RuntimeError('Wrangler readiness timeout')
        code=subprocess.call([sys.executable,'-m','pytest','test/test_against_web_api.py','test/test_alignment.py','-q','--tb=short'],cwd=root,env=env)
    finally:
        if server.poll() is None:
            if os.name=='nt':subprocess.run(['taskkill','/PID',str(server.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            else:os.killpg(server.pid,signal.SIGTERM)
            server.wait(timeout=20)
        if code:
            log.seek(0);print(log.read()[-5000:])
sys.exit(code)
