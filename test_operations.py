import base64
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import operations as ops
import study
import summarize
from test_study import TEXT, fixture, supports


class OperationsTests(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        for name in ('transcript', 'summarize', 'prompts'):
            (self.root / name).mkdir()
        (self.root / 'prompts/kajian.md').write_text('Study prompt')
        self.path = self.root / 'transcript/kajian.md'
        self.path.write_text(TEXT)

    def cli(self, *args):
        stream = io.StringIO()
        with patch.dict(os.environ, {'KAJIAN_ROOT': str(self.root), 'TYPESAFE_API_KEY': 'test-only'}), redirect_stdout(stream):
            summarize.main([str(self.path), *args])
        return stream.getvalue()

    def generate(self, *args):
        _, draft = fixture()
        with patch('study.label_chunks', return_value=[]), patch('study.codex_json', side_effect=[{'mentions': []}, draft]), patch('study.ask_jev', side_effect=supports):
            return self.cli('--draft', *args)

    def test_generation_events_history_and_checkpoint_commit(self):
        expected = ops.revision(self.root, self.path)
        events = [json.loads(line) for line in self.generate('--events-json', '--expected-revision', expected).splitlines()]
        self.assertEqual(events[0]['job']['stage'], 'parsing')
        self.assertEqual(events[-1]['job']['status'], 'succeeded')
        self.assertTrue({'extraction', 'references', 'drafting', 'verification', 'saving'} <= {event['job']['stage'] for event in events})
        records = ops.jobs(self.root)
        self.assertEqual(records[0]['origin'], 'command')
        self.assertEqual(records[0]['status'], 'succeeded')
        self.assertFalse(study.draft_checkpoint(self.path, self.root).exists())
        md = (self.root / 'summarize/kajian.md').read_text()
        evidence = json.loads((self.root / 'summarize/kajian.evidence.json').read_text())
        self.assertEqual(evidence['summary_hash'], study.digest(md))

    def test_publication_failure_keeps_checkpoint_and_retry_skips_codex(self):
        with patch('study.save_study', side_effect=OSError('disk full')):
            with self.assertRaises(SystemExit): self.generate('--events-json')
        self.assertTrue(study.draft_checkpoint(self.path, self.root).exists())
        self.assertFalse((self.root / 'summarize/kajian.md').exists())
        self.assertEqual(ops.jobs(self.root)[0]['status'], 'failed')
        with patch('study.codex_json', side_effect=AssertionError('draft called twice')), patch('study.ask_jev', side_effect=supports):
            self.cli('--draft')
        self.assertFalse(study.draft_checkpoint(self.path, self.root).exists())

    def test_external_edits_during_job_are_not_overwritten(self):
        self.generate()
        output = self.root / 'summarize/kajian.md'
        original_verify = study.verify_study
        def edit(*args):
            result = original_verify(*args)
            output.write_text('Owner edited this while verification ran.')
            return result
        with patch('study.verify_study', side_effect=edit), patch('study.ask_jev', side_effect=supports):
            with self.assertRaises(SystemExit): self.cli('--verify')
        self.assertEqual(output.read_text(), 'Owner edited this while verification ran.')
        self.assertEqual(ops.jobs(self.root)[0]['code'], 'conflict')

    def test_stale_web_review_and_offline_owner_decisions(self):
        self.generate()
        evidence = self.root / 'summarize/kajian.evidence.json'
        metadata = json.loads(evidence.read_text())
        metadata['claims']['c001']['check']['confidence'] = .4
        evidence.write_text(json.dumps(metadata))
        item = ops.catalog(self.root)[0]
        request = {'action': 'accept', 'transcript_id': item['id'], 'revision': item['revision'], 'claim_id': 'c001', 'reason': 'Checked the quoted source.'}
        with patch.dict(os.environ, {'KAJIAN_ROOT': str(self.root)}, clear=True), redirect_stdout(io.StringIO()), patch('study.ask_jev', side_effect=AssertionError('network')):
            ops.web_request(self.root, request)
            accepted = evidence.read_bytes()
            with self.assertRaises(SystemExit): ops.web_request(self.root, request)
            self.assertEqual(evidence.read_bytes(), accepted)
            request = {**request, 'action': 'approve', 'revision': ops.revision(self.root, self.path), 'attested': True}
            ops.web_request(self.root, request)
        self.assertEqual(json.loads(evidence.read_text())['human_review'], 'reviewed')

    def test_lock_blocks_import_and_cli_in_separate_process(self):
        with ops.operation_lock(self.root):
            with self.assertRaisesRegex(ops.OperationError, 'Proses lain'):
                ops.import_transcript(self.root, {'filename': 'new.txt', 'content': base64.b64encode(b'Amanah.').decode()})
            result = subprocess.run([sys.executable, 'summarize.py', str(self.path), '--draft', '--events-json'],
                                    cwd=Path(__file__).parent, env={**os.environ, 'KAJIAN_ROOT': str(self.root)}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)['code'], 'busy')
        self.assertEqual(ops.jobs(self.root), [])

    def test_interrupted_history_reconciles_only_after_lock_released(self):
        with ops.operation_lock(self.root), ops.Job(self.root, self.path, 'draft') as job:
            self.assertEqual(ops.jobs(self.root)[0]['status'], 'running')
            identifier = job.record['id']
        job.record.update(status='running', pid=999999, process_started='terminated worker')
        ops.atomic_json(job.path, job.record)
        self.assertEqual(ops.jobs(self.root)[0]['status'], 'interrupted')
        self.assertEqual(ops.jobs(self.root)[0]['id'], identifier)

    def test_status_reads_do_not_acquire_the_mutation_lock(self):
        with patch('operations.operation_lock', side_effect=AssertionError('status took the write lock')):
            self.assertFalse(ops.status(self.root)['busy'])
            self.assertEqual(ops.jobs(self.root), [])
        with ops.operation_lock(self.root), ops.Job(self.root, self.path, 'draft') as job:
            with patch('operations.operation_lock', side_effect=AssertionError('status took the write lock')):
                self.assertTrue(ops.status(self.root)['busy'])
            job.complete()

    def test_imports_validate_encoding_paths_identity_and_size(self):
        def request(filename, raw):
            return {'filename': filename, 'content': base64.b64encode(raw).decode()}
        for filename, raw in [('../bad.txt', b'ok'), ('bad.pdf', b'ok'), ('empty.txt', b'  '), ('binary.txt', b'\xff'),
                              ('large.txt', b'a' * (ops.MAX_INPUT + 1)), ('mixed.md', b'**0:01** \xc2\xb7 hello\nUnmarked'),
                              ('source.txt', b'source: file:///etc/passwd\n\nhello')]:
            with self.subTest(filename=filename), self.assertRaises(ValueError):
                ops.import_transcript(self.root, request(filename, raw))
        imported = ops.import_transcript(self.root, request("أمانة 'quote'.txt", 'Jagalah amanah.'.encode()))
        self.assertEqual(imported['format'], 'plain')
        self.assertEqual(imported['passages'], 1)
        self.assertEqual(imported['commands']['draft'].split()[0], 'rtk')
        import shlex
        self.assertIn("transcript/أمانة 'quote'.txt", shlex.split(imported['commands']['draft']))
        with self.assertRaises(ops.OperationError):
            ops.import_transcript(self.root, request("أمانة 'quote'.md", b'Another text'))
        with self.assertRaises(ops.OperationError):
            ops.import_transcript(self.root, request('duplicate.md', TEXT.encode()))
        self.assertEqual(len(list((self.root / 'transcript').iterdir())), 2)

    def test_escaping_symlinks_are_not_read_or_overwritten(self):
        outside = self.root / 'private.txt'; outside.write_text('Private')
        path = self.root / 'transcript/escape.txt'; path.symlink_to(outside)
        item = next(item for item in ops.catalog(self.root) if item['filename'] == 'escape.txt')
        self.assertIn('error', item)
        with self.assertRaises(ops.OperationError): ops.resolve_transcript(self.root, item['id'])
        (self.root / 'summarize/kajian.md').symlink_to(outside)
        with self.assertRaises(ops.OperationError): ops.revision(self.root, self.path)
        self.assertEqual(outside.read_text(), 'Private')

    def test_stale_revision_stops_before_any_service_call(self):
        revision = ops.revision(self.root, self.path)
        self.path.write_text(TEXT + '\n')
        with patch('study.codex_json', side_effect=AssertionError('network')):
            with self.assertRaises(SystemExit): self.cli('--draft', '--expected-revision', revision)
        self.assertEqual(ops.jobs(self.root), [])

    def test_failures_do_not_expose_environment_secrets(self):
        with patch.dict(os.environ, {'TYPESAFE_API_KEY': 'private-key', 'OTHER_TOKEN': 'second-secret'}):
            self.assertEqual(ops.clean_error(RuntimeError('private-key second-secret')), '<REDACTED> <REDACTED>')
        with patch.dict(os.environ, {'KAJIAN_ROOT': str(self.root)}, clear=True), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit): summarize.main([str(self.path), '--draft', '--events-json'])
        self.assertEqual(ops.jobs(self.root)[0]['code'], 'prerequisite')


if __name__ == '__main__':
    unittest.main()
