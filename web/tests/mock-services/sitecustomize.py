"""Service doubles loaded only by the Playwright server's PYTHONPATH."""

import os
from pathlib import Path
import time

import study


def codex(prompt, payload, schema, root):
    delay = root / '.fixture-delay'
    if delay.exists():
        time.sleep(float(delay.read_text()))
    with (root / '.fixture-codex-calls').open('a') as stream:
        stream.write('call\n')
    if 'mentions' in schema['properties']:
        return {'mentions': []}
    transcript = payload['transcript']
    point = {'text': 'Jagalah amanah dalam kehidupan sehari-hari.', 'source_ids': [transcript['passages'][0]['id']],
             'reference_ids': [], 'basis': 'transcript', 'label': ''}
    return {'title': transcript['title'], 'speaker': 'Pemateri uji', 'overview': [point],
            'sections': [{'title': 'Menjaga amanah', 'points': [point]}], 'stories': [], 'qa': [], 'actions': [], 'closing': [], 'review_notes': []}


def jev(state, questions):
    root = Path(os.environ['KAJIAN_ROOT'])
    fail = root / '.fixture-fail-once'
    if fail.exists() and 'items' in state:
        fail.unlink()
        raise RuntimeError('Layanan uji tidak tersedia. Coba lagi.')
    return {'model': 'fixture-jev', 'answers': {key: {'choice': 'supports' if 'items' in state else 'teaching',
            'confidence': .6 if 'items' in state and index == 0 else .95}
            for index, key in enumerate(questions)}}


study.codex_json = codex
study.ask_jev = jev
study.label_chunks = lambda chunks: []
