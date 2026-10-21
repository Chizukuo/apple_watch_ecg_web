# Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later
"""Independent end-to-end regression against the pinned Python reference."""
import json
import os
from pathlib import Path
import pymupdf
import numpy as np
import pytest
import requests
from test_against_web_api import A, API_URL, build_apple_like_pdf, make_beats, synth_signal, waves_variant, post_to_web, require_api

CASES = [
    (72, {}, 'unknown', 'wrist'), (110, {}, 'unknown', 'wrist'), (130, {}, 'unknown', 'wrist'),
    (72, {'t_shift': .07}, 'unknown', 'wrist'), (72, {'t_shift': .12}, 'unknown', 'wrist'),
    (72, {'t_shift': -.04}, 'unknown', 'wrist'), (72, {'t_shift': -.07}, 'unknown', 'wrist'),
    (72, {'qrs_scale': 2}, 'unknown', 'wrist'), (72, {'p_at': -.27}, 'unknown', 'wrist'),
    (72, {'p_at': -.1}, 'unknown', 'wrist'), (72, {'st': .25}, 'unknown', 'wrist'),
    (72, {'st': -.2}, 'unknown', 'wrist'), (72, {'t_amp': -.3}, 'unknown', 'wrist'),
    (72, {'t_amp': .04, 't_shift': .12}, 'unknown', 'wrist'),
    (58, {'t_amp': 1.2, 't_sd': .05, 't_shift': .05}, 'unknown', 'wrist'),
    (72, {'t_shift': .05}, 'male', 'wrist'), (72, {'t_shift': .05}, 'female', 'wrist'),
    (72, {'st': .25}, 'unknown', 'other'), (72, {'qrs_scale': 2.6, 't_amp': -.3}, 'unknown', 'wrist'),
]

@pytest.mark.parametrize('hr,kw,sex,placement', CASES)
def test_morphology_pdf_matches_python(tmp_path, hr, kw, sex, placement):
    t, v = synth_signal(make_beats(hr=hr), waves=waves_variant(**kw))
    path = tmp_path / 'synthetic.pdf'
    build_apple_like_pdf(path, t, v, bpm=hr)
    rec = A.load(path)
    expected = A.analyze(rec, sex=sex, placement=placement)['report']
    status, actual = post_to_web(path, params={'sex': sex, 'placement': placement})
    assert status == 200, actual
    assert actual['coverage']['samples'] == len(rec.t)
    assert actual['rhythm'] == expected['rhythm']
    assert actual['hrv'] == expected['hrv']
    assert actual['morphology'] == expected['morphology']
    assert actual['beats'] == expected['beats']
    assert actual['quality'] == expected['quality']
    assert actual['summary'] == A.summary_row(expected)
    assert [(a['code'], a['level'], a['value']) for a in actual['morphology_alerts']['alerts']] == [(a['code'], a['level'], a['value']) for a in expected['morphology_alerts']['alerts']]
    assert bool(actual['morphology_alerts']['skipped']) == bool(expected['morphology_alerts']['skipped'])

def test_exclude_and_csv(tmp_path):
    path = tmp_path / 'synthetic.pdf'
    t, v = synth_signal(make_beats())
    build_apple_like_pdf(path, t, v)
    rec = A.load(path)
    expected = A.analyze(rec, exclude=[(0,2),(14,16)])['report']
    status, actual = post_to_web(path, params={'exclude':'0-2,14-16'})
    assert status == 200
    assert actual['rhythm'] == expected['rhythm']
    assert actual['hrv'] == expected['hrv']
    response = requests.post(API_URL+'?format=csv&exclude=0-2,14-16',data=path.read_bytes(),timeout=30)
    assert response.status_code == 200
    from io import StringIO
    import pandas as pd
    data = pd.read_csv(StringIO(response.content.decode('utf-8-sig')))
    assert len(data) == len(rec.t)
    np.testing.assert_allclose(data['voltage_mv'],rec.v.round(5), atol=1e-5)
    assert list(data.columns) == ['time_s','voltage_mv','clipped','beat']

@pytest.mark.parametrize('extension',['png','jpg','pdf'])
def test_raster_input(tmp_path, extension):
    source = tmp_path/'source.pdf'
    t,v = synth_signal(make_beats(events={8:'V'}))
    build_apple_like_pdf(source,t,v)
    with pymupdf.open(source) as doc:
        pix=doc[0].get_pixmap(dpi=200)
        image=tmp_path/'image.png';pix.save(image)
        path=tmp_path/('raster.'+extension)
        if extension == 'pdf':
            scan=pymupdf.open();page=scan.new_page(width=doc[0].rect.width,height=doc[0].rect.height)
            page.insert_image(page.rect,filename=image);scan.save(path,deflate=True);scan.close()
        else:pix.save(path)
    expected=A.analyze(A.load(path))['report']
    status,actual=post_to_web(path)
    assert status == 200, actual
    assert actual['source'] == 'raster'
    assert actual['record_id'] == expected['record_id']
    assert actual['rhythm']['beats'] == expected['rhythm']['beats']
    assert actual['rhythm']['n_premature_diff'] == expected['rhythm']['n_premature_diff'] == 1
    assert abs(actual['rhythm']['hr_bpm']-expected['rhythm']['hr_bpm']) < .2

def test_invalid_params_and_multipart():
    for query in ['exclude=bad','exclude=0-2junk','sex=M','placement=chest','include_identity=yes']:
        r=requests.post(API_URL+'?format=json&'+query,data=b'',timeout=10)
        assert r.status_code == 400
        assert r.headers['Cache-Control']=='no-store'
    r=requests.post(API_URL+'?format=json',data=b'bad',headers={'Content-Type':'multipart/form-data'},timeout=10)
    assert r.status_code==400

def test_readme_python_example(tmp_path, monkeypatch):
    import re
    source = (Path(__file__).resolve().parent.parent/'README.md').read_text(encoding='utf8')
    snippet = re.search(r'```python\n(.*?)```',source,re.S).group(1)
    t,v=synth_signal(make_beats(),waves=waves_variant(t_shift=.12))
    build_apple_like_pdf(tmp_path/'记录.pdf',t,v)
    snippet=snippet.replace('http://127.0.0.1:8788/api/analyze',API_URL)
    monkeypatch.chdir(tmp_path)
    namespace={}
    exec(compile(snippet,'README.md','exec'),namespace)
    assert namespace['data']['morphology_alerts']['alerts'][0]['code']=='QTC_LONG_MARKED'
