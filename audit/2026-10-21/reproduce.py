"""Reproduce the review with synthetic inputs only; writes evidence.json beside this file.
Run: python audit/2026-10-21/reproduce.py [path-to-python-project]
Requires the Python reference dependencies and the web project's npm dependencies.
"""
from pathlib import Path
import sys, json, subprocess, tempfile
import numpy as np
import pymupdf
import neurokit2 as nk
from scipy.ndimage import maximum_filter1d
from scipy.signal import butter, sosfiltfilt

HERE = Path(__file__).resolve().parent
WEB = HERE.parent.parent
PY = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else WEB.parent / 'apple_watch_ecg'
sys.path[:0] = [str(PY), str(PY / 'tests')]
import apple_watch_ecg as A
from synth import make_beats, synth_signal, waves_variant, build_apple_like_pdf

def slim(rep):
    result = {k: rep.get(k) for k in ('rhythm', 'hrv', 'morphology', 'morphology_alerts')}
    if result['morphology_alerts']:
        result['morphology_alerts'] = {k:v for k,v in result['morphology_alerts'].items() if k != 'qtc_formula'}
    return result

def diff(a,b,p=''):
    if isinstance(a,dict) and isinstance(b,dict):
        return [d for k in sorted(a.keys() | b.keys()) for d in diff(a.get(k),b.get(k),p+'.'+k)]
    if isinstance(a,list) and isinstance(b,list):
        if len(a)!=len(b): return [{'field':p, 'python':a,'web':b}]
        return [d for i,(x,y) in enumerate(zip(a,b)) for d in diff(x,y,p+f'[{i}]')]
    if a != b: return [{'field':p, 'python':a, 'web':b}]
    return []

evidence = {'scope':'local source review, synthetic inputs only', 'raw_signal_cases':[], 'pdf_cases':[]}
with tempfile.TemporaryDirectory(prefix='ecg-review-') as tmp:
    tmp=Path(tmp)
    bundle=tmp/'probe.mjs'
    subprocess.run(['node',str(WEB/'node_modules/esbuild/bin/esbuild'),str(HERE/'probe.ts'),'--bundle','--platform=node','--format=esm','--outfile='+str(bundle)],check=True,capture_output=True)
    def probe(jobs):
        r=subprocess.run(['node',str(bundle)],input=json.dumps(jobs),text=True,encoding='utf-8',capture_output=True,check=True)
        return json.loads(r.stdout)
    configs=[('normal',72,{}),('fast110',110,{}),('fast130',130,{}),('longQT',72,{'t_shift':.07}),('markedLongQT',72,{'t_shift':.12}),('shortQT',72,{'t_shift':-.04}),('markedShortQT',72,{'t_shift':-.07}),('wideQRS',72,{'qrs_scale':2}),('longPR',72,{'p_at':-.27}),('shortPR',72,{'p_at':-.1}),('STup',72,{'st':.25}),('STdown',72,{'st':-.20}),('Tinverted',72,{'t_amp':-.30}),('flatT',72,{'t_amp':.04,'t_shift':.12}),('tallT',58,{'t_amp':1.2,'t_sd':.05,'t_shift':.05})]
    for name,hr,kw in configs:
        t,v=synth_signal(make_beats(hr=hr), waves=waves_variant(**kw))
        rec=A.Recording(Path('synthetic'),{}, {}, [], 'synthetic',512,'SYNTHETIC_AUDIT',t,v,np.zeros(len(v),bool))
        py=A.analyze(rec)['report']
        web=probe([{'t':t.tolist(),'v':v.tolist(),'fs':512}])[0]
        evidence['raw_signal_cases'].append({'name':name,'python':slim(py),'web':slim(web.get('report',{})),'differences':diff(slim(py),slim(web.get('report',{}))), 'svgNormalClaim':web.get('svgNormalClaim')})
    evidence['other_sampling_rates']=[]
    for fs in [256,1000]:
        t,v=synth_signal(make_beats(),fs=fs)
        rec=A.Recording(Path('synthetic'),{}, {}, [], 'synthetic',fs,'SYNTHETIC_AUDIT',t,v,np.zeros(len(v),bool))
        py=A.analyze(rec)['report'];web=probe([{'t':t.tolist(),'v':v.tolist(),'fs':fs}])[0]
        evidence['other_sampling_rates'].append({'fs':fs,'python':slim(py),'web':slim(web.get('report',{})),'error':web.get('error'),'differences':diff(slim(py),slim(web.get('report',{})))})
    pdf=tmp/'normal.pdf'
    t,v=synth_signal(make_beats())
    build_apple_like_pdf(pdf,t,v)
    # Same visual PDF with one combined /Contents stream versus many page streams.
    doc=pymupdf.open(pdf)
    page=doc[0]
    content=page.read_contents()
    xref=doc.get_new_xref(); doc.update_object(xref,'<<>>');doc.update_stream(xref,content);page.set_contents(xref)
    combined=tmp/'combined.pdf';doc.save(combined,garbage=4);doc.close()
    # Valid PDF content can start a compressed stream with a whitespace byte.
    doc=pymupdf.open(combined); page=doc[0];xref=page.get_contents()[0]
    doc.update_stream(xref,b'\n'+doc.xref_stream(xref));leading=tmp/'leading-whitespace.pdf';doc.save(leading,deflate=True);doc.close()
    doc=pymupdf.open(combined);page=doc[0];content=page.read_contents()
    cut=content.find(b'\n',len(content)//2)+1
    refs=[]
    for part in (content[:cut],content[cut:]):
        xref=doc.get_new_xref();doc.update_object(xref,'<<>>');doc.update_stream(xref,part);refs.append(xref)
    doc.xref_set_key(page.xref,'Contents','['+' '.join(f'{x} 0 R' for x in refs)+']')
    split=tmp/'split.pdf';doc.save(split,garbage=4);doc.close()
    for name,path in [('normal',pdf),('combined_contents',combined),('compressed_leading_newline',leading),('split_contents',split)]:
        rec=A.load(path); py=A.analyze(rec)['report']; web=probe([{'path':str(path)}])[0]
        evidence['pdf_cases'].append({'name':name,'python_samples':len(rec.t),'web_samples':web.get('samples'),'python_end':float(rec.t[-1]),'web_end':web.get('end'),'python':slim(py),'web':slim(web.get('report',{})),'error':web.get('error'),'differences':diff(slim(py),slim(web.get('report',{})))})
    # Untrusted metadata fs range must not drive unbounded allocation.
    badmeta=tmp/'fs9999.pdf';build_apple_like_pdf(badmeta,t,v,fs=9999)
    evidence['sampling_metadata']={'python_fs':A.load(badmeta).fs,'web':probe([{'op':'parse','path':str(badmeta)}])[0]}
    x=(np.sin(np.arange(2000)*.09)+2).tolist()
    dsp=probe([{'op':'dsp','v':x,'fs':512,'size':4}])[0]
    high=sosfiltfilt(butter(5,.5,btype='highpass',output='sos',fs=512),x)
    clean=nk.ecg_clean(np.array(x),sampling_rate=512,method='neurokit')
    evidence['dsp']={'highpass_max_abs_error':float(np.max(np.abs(high-dsp['highpass']))),'highpass_middle_max_abs_error':float(np.max(np.abs(high[512:-512]-np.array(dsp['highpass'])[512:-512]))),'clean_max_abs_error':float(np.max(np.abs(clean-dsp['clean']))),'maximum_filter_even_mismatch_count':int(np.sum(maximum_filter1d(x,size=4,mode='nearest')!=dsp['maximum']))}
    data={'rhythm':{'hr_bpm':72,'n_normal':35,'n_odd':0},'morphology':{'qtc_bazett_ms':420,'qtc_fridericia_ms':410,'qt_reliable':True,'pr_ms':180},'flags':['HRV 来自约 30 秒的超短时记录，仅供同条件下自身对比','PDF 一律标注“导联 I”；若手表不是贴在对侧手腕上记录，则不是标准导联 I'],'svg':'<svg/>','hrv':{'rmssd_ms':0}}
    cases=[{'case':'normal',**data}]
    for name,qtc in [('boundary450',450),('boundary360',360)]: cases.append({**data,'case':name,'morphology':{**data['morphology'],'qtc_bazett_ms':qtc}})
    cases += [{**data,'case':'unreliableQT','morphology':{**data['morphology'],'qtc_bazett_ms':520,'qt_reliable':False}}, {**data,'case':'generic_exclusion','flags':data['flags']+['跨越这些时段的间隔不计入 RR/HRV，也不会被当作停顿']}, {**data,'case':'sinus_with_premature','flags':data['flags']+['手表判为窦性心律与上述提示并不矛盾：Apple 的算法只区分房颤与窦性心律，不识别早搏和停顿']},{**data,'case':'odd_only','rhythm':{**data['rhythm'],'n_odd':1}},{**data,'case':'fast_formula','rhythm':{**data['rhythm'],'hr_bpm':115},'morphology':{**data['morphology'],'qtc_bazett_ms':480,'qtc_fridericia_ms':430}}]
    evidence['ui']=probe([{'op':'ui','path':str(WEB/'public/index.html'),'cases':cases}])[0]
    # Local API negative/contract checks (no private records).
    import requests
    api='http://127.0.0.1:8788/api/analyze'
    evidence['api']=[]
    for params in [{'format':'json'},{'format':'json','exclude':'bad'},{'format':'json','exclude':'0-2junk'},{'format':'json','sex':'M','placement':'chest'}]:
        r=requests.post(api,params=params,data=pdf.read_bytes(),headers={'Content-Type':'application/pdf'},timeout=30);j=r.json()
        evidence['api'].append({'params':params,'status':r.status_code,'identity_present':bool(j.get('identity',{}).get('name')),'exclude':j.get('quality',{}).get('manual_exclude_s'),'alert_options':{k:j.get('morphology_alerts',{}).get(k) for k in ('sex','placement')},'top_level_keys':list(j),'alerts_example_works':bool(j.get('alerts'))})
    # Check documentation's alert key using a case that actually triggers an alert.
    tlong,vlong=synth_signal(make_beats(),waves=waves_variant(t_shift=.12)); longpdf=tmp/'long.pdf';build_apple_like_pdf(longpdf,tlong,vlong)
    r=requests.post(api+'?format=json',data=longpdf.read_bytes(),headers={'Content-Type':'application/pdf'},timeout=30);j=r.json()
    evidence['readme_alert_example']={'status':r.status_code,'data_get_alerts':j.get('alerts'),'actual_alert_codes':[a['code'] for a in j.get('morphology_alerts',{}).get('alerts',[])]}
    r=requests.post(api+'?format=json',data=b'bad multipart',headers={'Content-Type':'multipart/form-data'},timeout=30)
    evidence['malformed_multipart']={'status':r.status_code,'cache_control':r.headers.get('cache-control'),'body':r.json()}

(HERE/'verification.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'raw_cases':len(evidence['raw_signal_cases']),'raw_cases_with_differences':sum(bool(x['differences']) for x in evidence['raw_signal_cases']),'pdf_cases':[{k:v for k,v in x.items() if k in ('name','python_samples','web_samples','error')} for x in evidence['pdf_cases']],'dsp':evidence['dsp'],'ui':evidence['ui']},ensure_ascii=True,indent=2))
