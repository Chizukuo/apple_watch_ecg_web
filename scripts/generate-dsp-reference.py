# Copyright (C) 2026 Chizukuo. SPDX-License-Identifier: GPL-3.0-or-later
"""Regenerate numerical fixtures from the reference libraries, never from the TS implementation."""
import json
from pathlib import Path
import numpy as np
import scipy
from scipy.signal import butter, sosfiltfilt
from scipy.ndimage import maximum_filter1d
import neurokit2 as nk

cases = []
for fs in [100, 256, 512, 1000, 2000]:
    x = 2 + np.sin(np.arange(2048) * .09)
    x[700:1050] += .4
    cases.append(dict(fs=fs, input=x.tolist(), highpass=sosfiltfilt(butter(5,.5,btype='highpass',output='sos',fs=fs),x).tolist(), clean=nk.ecg_clean(x,sampling_rate=fs,method='neurokit').tolist()))
small=np.array([1.,2.,10.,2.,1.,8.,3.,-1.])
out=dict(provenance=dict(numpy=np.__version__, scipy=scipy.__version__, neurokit2=nk.__version__), cases=cases, maximum=dict(input=small.tolist(), expected={str(n):maximum_filter1d(small,size=n,mode='nearest').tolist() for n in [3,4,8]}))
Path('test/fixtures/dsp-reference.json').write_text(json.dumps(out,separators=(',',':')),encoding='utf8')
