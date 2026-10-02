import json
import io
import unittest
import urllib.error
import copy
import summarize
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import study
from summarize import parse_transcript, ask_jev, TypeSafeError


TEXT = 'title: "Kajian"\nsource: "https://www.youtube.com/watch?v=test"\n## Transcript\n**0:01** · Surah Yusuf 55 tentang amanah.\n**0:20** · Berikan manfaat sesuai kemampuan, bukan kewajiban baru.\n'


def point(text="Pembicara menjelaskan amanah.", **extra):
    return {"text": text, "source_ids": ["T000001"], "reference_ids": [], "basis": "transcript", **extra}


def fixture():
    transcript = parse_transcript(TEXT)
    draft = {"title": "Kajian", "speaker": "Pemateri", "overview": [point()],
             "sections": [{"title": "Amanah", "points": [point()]}], "stories": [],
             "qa": [{"question": "Apakah wajib?", "answer": point("Tidak menjadi kewajiban baru.", source_ids=["T000020"])}],
             "actions": [point("Membantu sesuai kemampuan.", source_ids=["T000020"])], "closing": [], "review_notes": []}
    return transcript, draft


def supports(state, questions):
    return {"model": "jev-test", "answers": {key: {"choice": "supports", "confidence": .95} for key in questions}}


class StudyTests(unittest.TestCase):
    def review_fixture(self, directory):
        transcript, draft = fixture()
        root = Path(directory)
        path = root / 'input.md'; path.write_text(TEXT)
        output = root / 'summarize' / 'input.md'
        md, claims = study.render_study(transcript, draft, [])
        with patch('study.ask_jev', side_effect=supports):
            md, meta = study.verify_study(md, {"schema_version": 2, "references": [], "claims": claims}, transcript, path)
        meta['claims']['c001']['check']['confidence'] = .4
        study.save_study(output, md, meta, False)
        return path, output, md, meta, transcript

    def test_owner_review_accept_approve_unaccept_and_offline_cli(self):
        with TemporaryDirectory() as directory:
            path, output, md, meta, transcript = self.review_fixture(directory)
            evidence = output.with_suffix('.evidence.json')
            with patch('study.ask_jev', side_effect=AssertionError('network')), patch('study.codex_json', side_effect=AssertionError('Codex')):
                before = evidence.read_bytes()
                self.assertIn('awaiting owner review: 1', study.review_study(output, md, meta, transcript, path))
                self.assertEqual(evidence.read_bytes(), before)
                with self.assertRaisesRegex(ValueError, 'incomplete'):
                    study.review_study(output, md, meta, transcript, path, 'approve')
                for cid, reason in [('c999', 'Source checked.'), ('c002', 'Source checked.'), ('c001', '  ')]:
                    with self.assertRaises(ValueError): study.review_study(output, md, meta, transcript, path, 'accept', cid, reason)
                    self.assertEqual(evidence.read_bytes(), before)
                args = ['summarize.py', str(path), '--accept', 'c001', '--reason', 'Checked the cited source.']
                with patch('summarize.__file__', str(Path(directory)/'summarize.py')), patch('sys.argv', args), patch.dict('os.environ', {}, clear=True), patch('sys.stdout', new_callable=io.StringIO):
                    summarize.main()
                accepted = json.loads(evidence.read_text())
                self.assertEqual(study.owner_review_state(accepted, True), 'in_progress')
                self.assertEqual(accepted['claims'], meta['claims'])
                self.assertEqual(output.read_text(), md)
                study.review_study(output, md, accepted, transcript, path, 'approve')
                approved = json.loads(evidence.read_text())
                self.assertEqual(study.owner_review_state(approved, True), 'reviewed')
                before = evidence.read_bytes()
                self.assertIn('no files changed', study.review_study(output, md, approved, transcript, path, 'approve'))
                self.assertEqual(evidence.read_bytes(), before)
                study.review_study(output, md, approved, transcript, path, 'unaccept', 'c001')
                reopened = json.loads(evidence.read_text())
                self.assertEqual(reopened['human_review'], 'pending')
                self.assertIsNone(reopened['owner_review']['reviewed_at'])
                self.assertEqual(reopened['owner_review']['accepted_claims'], {})

    def test_owner_review_validation_staleness_and_failed_writes(self):
        with TemporaryDirectory() as directory:
            path, output, md, meta, transcript = self.review_fixture(directory)
            evidence = output.with_suffix('.evidence.json')
            before = evidence.read_bytes()
            damaged = []
            for mutate in [lambda m: m['claims']['c001'].pop('check'),
                           lambda m: m['claims']['c001'].update(kind='unknown'),
                           lambda m: m['claims']['c001']['check'].update(confidence=True),
                           lambda m: m['claims']['c001']['check'].update(confidence=float('nan')),
                           lambda m: m['claims']['c001']['check'].update(checked_at='bad'),
                           lambda m: m['claims']['c001'].update(content_hash='bad'),
                           lambda m: m['claims'].pop('c002'),
                           lambda m: m.update(references=[None])]:
                value = copy.deepcopy(meta); mutate(value); damaged.append(value)
            for value in [None, {}, *damaged]:
                with self.assertRaises(ValueError): study.review_study(output, md, value, transcript, path, 'accept', 'c001', 'Checked.')
                self.assertEqual(evidence.read_bytes(), before)
            for edited in [md.replace('amanah.', 'amanah baru.'), md.replace('study:end c001', 'study:end c999')]:
                altered = {**meta, 'summary_hash': study.digest(edited)}
                with self.assertRaises(ValueError): study.review_study(output, edited, altered, transcript, path, 'accept', 'c001', 'Checked.')
            path.write_text(TEXT + '\n**0:30** · Sumber berubah.\n')
            with self.assertRaisesRegex(ValueError, 'stale'): study.review_study(output, md, meta, transcript, path, 'approve')
            self.assertNotIn('confidence', study.review_study(output, md, meta, transcript, path))
            path.write_text(TEXT)
            replace = Path.replace
            def fail_review(source, target):
                if target == evidence: raise OSError('write failed')
                return replace(source, target)
            with patch.object(Path, 'replace', fail_review), self.assertRaises(OSError):
                study.review_study(output, md, meta, transcript, path, 'accept', 'c001', 'Checked.')
            self.assertEqual(evidence.read_bytes(), before)
            self.assertEqual(output.read_text(), md)

    def test_owner_review_reverification_reset_and_metadata_archive_identity(self):
        with TemporaryDirectory() as directory:
            path, output, md, meta, transcript = self.review_fixture(directory)
            evidence = output.with_suffix('.evidence.json')
            study.review_study(output, md, meta, transcript, path, 'accept', 'c001', 'First source review.')
            accepted = json.loads(evidence.read_text())
            study.save_study(output, md, accepted, True)
            study.review_study(output, md, accepted, transcript, path, 'accept', 'c001', 'Second source review.')
            again = json.loads(evidence.read_text())
            study.save_study(output, md, again, True)
            archives = [json.loads(p.read_text()) for p in (output.parent/'archive').glob('*.evidence.json')]
            self.assertEqual(len(archives), 2)
            self.assertEqual({m['owner_review']['accepted_claims']['c001']['reason'] for m in archives}, {'First source review.', 'Second source review.'})
            with patch('study.ask_jev', side_effect=supports):
                new_md, reset = study.verify_study(md, again, transcript, path)
            self.assertEqual(reset['human_review'], 'pending')
            self.assertNotIn('owner_review', reset)
            self.assertEqual(study.owner_review_state(again, False), 'stale')
            self.assertEqual(study.owner_review_state({**again, 'checked_at': '2026-09-30T01:00:00Z'}, True), 'stale')
            broken = copy.deepcopy(again); broken['owner_review']['accepted_claims']['c001']['reason'] = ''
            self.assertEqual(study.owner_review_state(broken, True), 'stale')

    def test_http_error_keeps_reason_and_redacts_key(self):
        secret = "fake-typesafe-key-do-not-print"
        error = urllib.error.HTTPError('https://api.typesafe.ai/v1/systemone', 400, 'Bad Request', {},
            io.BytesIO(json.dumps({"detail": {"error_type": "max_tokens_exceeded", "key": secret}}).encode()))
        with patch.dict('os.environ', {"TYPESAFE_API_KEY": secret}), patch('urllib.request.urlopen', side_effect=error):
            with self.assertRaises(TypeSafeError) as caught: ask_jev({}, {})
        self.assertIn('max_tokens_exceeded', str(caught.exception))
        self.assertNotIn(secret, str(caught.exception))

    def test_evidence_batch_splits_only_for_token_limit_and_keeps_order(self):
        p = {"id": "P001", "text": "Amanah.", "context": [{"id": "P001", "text": "Amanah."}, {"id": "P002", "text": "Konteks."}]}
        batch = [{"id": f"c{i}", "kind": "transcript", "text": str(i), "evidence": [p, p], "check": {"verdict": "old"}} for i in range(6)]
        seen = []
        def limited(state, questions):
            if len(state['items']) > 2: raise TypeSafeError(400, '{"error_type":"max_tokens_exceeded"}')
            for item in state['items']:
                self.assertNotIn('check', item)
                self.assertEqual(item['evidence'], {"cited_passages": {"P001": "Amanah."}, "nearby_context": {"P002": "Konteks."}})
                seen.append(item['text'])
            return supports(state, questions)
        with patch('study.ask_jev', side_effect=limited):
            self.assertEqual(len(study.check_study_batch(batch)), 6)
        self.assertEqual(seen, [str(i) for i in range(6)])
        with patch('study.ask_jev', side_effect=TypeSafeError(400, 'invalid request')) as mock, self.assertRaises(TypeSafeError):
            study.check_study_batch(batch)
        self.assertEqual(mock.call_count, 1)
        with patch('study.ask_jev', side_effect=TypeSafeError(400, 'max_tokens_exceeded')), self.assertRaisesRegex(RuntimeError, 'block c0'):
            study.check_study_batch(batch[:1])

    def test_failed_verification_resumes_saved_draft_without_codex(self):
        transcript, draft = fixture()
        with TemporaryDirectory() as directory:
            root = Path(directory); (root/'prompts').mkdir(); (root/'prompts/kajian.md').write_text('Study prompt')
            path = root/'input.md'; path.write_text(TEXT)
            with patch('study.label_chunks', return_value=[]) as labels, patch('study.codex_json', side_effect=[{"mentions": []}, draft]) as codex, patch('study.verify_study', side_effect=[RuntimeError('service failed'), ('finished', {})]):
                with self.assertRaisesRegex(RuntimeError, 'service failed'): study.generate_study(transcript, path, root)
                self.assertEqual(len(list((root/'.cache/drafts').glob('*.json'))), 1)
                self.assertEqual(study.generate_study(transcript, path, root), ('finished', {}))
                self.assertEqual(codex.call_count, 2)
                self.assertEqual(labels.call_count, 1)
                self.assertEqual(len(list((root/'.cache/drafts').glob('*.json'))), 1)

    def test_untimed_no_qa_generation_and_reverification(self):
        raw = "Jagalah amanah.\n\nMengapa amanah penting? Pembicara menjelaskan manfaatnya bagi sesama."
        transcript = parse_transcript(raw, title="Amanah")
        _, draft = fixture()
        draft.update(overview=[point(source_ids=["P001"])], sections=[{"title": "Amanah", "points": [point(source_ids=["P002"])]}], qa=[], actions=[])
        md, claims = study.render_study(transcript, draft, [])
        self.assertIn("[Bagian P001]", md)
        self.assertIn("Tidak ada sesi tanya jawab yang teridentifikasi.", md)
        self.assertNotIn("t=None", md)
        self.assertNotIn("[Video sumber]", md)
        meta = {"schema_version": 2, "references": [], "claims": claims, "transcript_hash": study.digest(raw)}
        with TemporaryDirectory() as directory, patch("study.ask_jev", side_effect=supports):
            path = Path(directory) / "amanah.txt"; path.write_text(raw)
            verified, evidence = study.verify_study(md, meta, transcript, path)
            self.assertEqual(evidence["claims"]["c001"]["source_ids"], ["P001"])
            self.assertIsNone(evidence["claims"]["c001"]["evidence"][0]["seconds"])
            updated = verified.replace("Pembicara menjelaskan amanah.", "Pembicara membahas amanah.")
            _, evidence = study.verify_study(updated, evidence, transcript, path)
            self.assertIn("membahas", evidence["claims"]["c001"]["text"])
            for broken in (md.replace("P001]", "P999]"), md.replace("P001]", "P001], [Bagian SALAH]")):
                with self.assertRaises(ValueError): study.verify_study(broken, meta, transcript, path)
            with patch("study.label_chunks", return_value=[]), patch("study.codex_json", side_effect=[{"mentions": []}, draft]):
                generated, info = study.generate_study(transcript, path, Path(__file__).parent)
            self.assertIn("[Bagian P001]", generated)
            self.assertTrue(info["transcript_file"].endswith("amanah.txt"))
            self.assertEqual(info["source_url"], "")

    def test_edit_reverification_and_marker_validation(self):
        transcript, draft = fixture()
        md, claims = study.render_study(transcript, draft, [])
        with TemporaryDirectory() as directory, patch("study.ask_jev", side_effect=supports):
            path = Path(directory) / "input.md"; path.write_text(TEXT)
            meta = {"schema_version": 2, "references": [], "claims": claims, "transcript_hash": study.digest(TEXT)}
            verified, evidence = study.verify_study(md, meta, transcript, path)
            edited = verified.replace("Pembicara menjelaskan amanah.", "Pembicara membahas amanah secara khusus.")
            self.assertNotEqual(study.digest(edited), evidence["summary_hash"])
            again, updated = study.verify_study(edited, evidence, transcript, path)
            self.assertIn("secara khusus", updated["claims"]["c001"]["text"])
            self.assertEqual(again.count(study.REPORT), 1)
            self.assertEqual(study.digest(again), updated["summary_hash"])
        for broken in (md.replace("<!-- study:end c001 -->", ""), md + "Materi tambahan tanpa bukti.\n", md.replace("study:begin c001", "study:begin c999")):
            with self.assertRaises(ValueError): study.parse_blocks(broken)

    def test_external_evidence_and_quotation_integrity(self):
        transcript, draft = fixture()
        ref = {"id": "r001", "status": "resolved", "locator": "QS Yusuf: 55", "provider": "eQuran",
               "url": "https://equran.id/surat/12#ayat-55", "text": "Terjemahan yang diambil.", "source_ids": ["T000001"]}
        draft["sections"][0]["points"] = [point("Penjelasan dari sumber luar.", basis="external", source_ids=[], reference_ids=["r001"])]
        md, claims = study.render_study(transcript, draft, [ref])
        meta = {"schema_version": 2, "references": [ref], "claims": claims, "transcript_hash": study.digest(TEXT)}
        with TemporaryDirectory() as directory, patch("study.ask_jev", side_effect=supports) as mock:
            path = Path(directory) / "input.md"; path.write_text(TEXT)
            verified, evidence = study.verify_study(md, meta, transcript, path)
            study.validate_saved_study(verified, evidence, transcript, path)
            damaged = copy.deepcopy(evidence)
            quotation = next(x for x in damaged['claims'].values() if x['kind'] == 'quotation')
            quotation['check'].update(confidence=.95, model='jev-test')
            with self.assertRaisesRegex(ValueError, 'Saved finding'):
                study.validate_saved_study(verified, damaged, transcript, path)
            external = next(x for x in evidence["claims"].values() if x["kind"] == "external")
            self.assertEqual(external["evidence"], [ref])
            self.assertTrue(any("optional application" in q["instructions"] for call in mock.call_args_list for q in call.args[1].values()))
            with self.assertRaisesRegex(ValueError, "quotation changed"):
                study.verify_study(md.replace("> Terjemahan yang diambil.", "> Kutipan diganti."), meta, transcript, path)
            with self.assertRaisesRegex(ValueError, "Unknown or changed citation"):
                study.verify_study(md.replace("t=1s", "t=999s"), meta, transcript, path)

    def test_quran_exact_lookup_and_provider_failure(self):
        transcript, _ = fixture()
        mention = {"kind": "quran", "mention": "Surah Yusuf 55", "surah": 12, "verses": [55], "queries": [], "source_ids": ["T000001"]}
        response = {"retrieved_at": study.now(), "data": {"data": {"nomor": 12, "namaLatin": "Yusuf", "ayat": [{"nomorAyat": 55, "teksIndonesia": "Terjemahan asli.", "teksArab": "نص"}]}}}
        with patch("study.fetch_json", return_value=response), patch("study.ask_jev") as mock:
            result = study.retrieve_references([mention], transcript, Path("."))[0]
            self.assertEqual(result["text"], "Terjemahan asli.")
            self.assertEqual(result["status"], "resolved")
            self.assertEqual(result["url"], "https://equran.id/surat/12#ayat-55")
            mock.assert_not_called()
        with patch("study.fetch_json", side_effect=OSError("unavailable")):
            self.assertEqual(study.retrieve_references([mention], transcript, Path("."))[0]["status"], "unresolved")

    def test_hadith_match_ambiguity_and_service_failure(self):
        transcript, _ = fixture()
        mention = {"mention": "Hadis amanah", "source_ids": ["T000001"]}
        candidates = [{"id": "1", "text": "Amanah"}, {"id": "2", "text": "Tema lain"}]
        for choice, confidence, expected in (("0", .95, candidates[0]), ("0", .4, None), ("no_match", .95, None)):
            with patch("study.ask_jev", return_value={"model": "test", "answers": {"match": {"choice": choice, "confidence": confidence}}}):
                self.assertEqual(study.match_reference(mention, candidates, transcript)[0], expected)
        with patch("study.ask_jev", side_effect=RuntimeError("service down")), self.assertRaises(RuntimeError):
            study.match_reference(mention, candidates, transcript)

    def test_failure_keeps_previous_outputs_and_backup(self):
        with TemporaryDirectory() as directory:
            output = Path(directory) / "study.md"
            output.write_text("old notes")
            evidence = output.with_suffix(".evidence.json")
            evidence.write_text('{"old":true}')
            replace = Path.replace
            def fail_evidence_once(path, target):
                if target == evidence and fail_evidence_once.pending:
                    fail_evidence_once.pending = False
                    raise OSError("interrupted write")
                return replace(path, target)
            fail_evidence_once.pending = True
            with patch.object(Path, "replace", fail_evidence_once), self.assertRaises(OSError):
                study.save_study(output, "new", {"summary_hash": study.digest("new")}, True)
            self.assertEqual(output.read_text(), "old notes")
            self.assertEqual(json.loads(evidence.read_text()), {"old": True})
            self.assertEqual(next((Path(directory) / "archive").glob("*.md")).read_text(), "old notes")

    def test_unknown_source_or_unsupported_external_reference_rejected(self):
        transcript, draft = fixture()
        draft["overview"][0]["source_ids"] = ["T999999"]
        with self.assertRaises(ValueError): study.render_study(transcript, draft, [])

    def test_unsupported_action_stays_flagged(self):
        transcript, draft = fixture()
        draft["actions"] = [point("Wajib membantu seratus orang setiap hari.", source_ids=["T000020"])]
        md, claims = study.render_study(transcript, draft, [])
        meta = {"schema_version": 2, "references": [], "claims": claims, "transcript_hash": study.digest(TEXT)}
        def judged(state, questions):
            result = supports(state, questions)
            for i, item in enumerate(state["items"]):
                if item["kind"] == "action": result["answers"][str(i)]["choice"] = "insufficient"
            return result
        with TemporaryDirectory() as directory, patch("study.ask_jev", side_effect=judged):
            path = Path(directory) / "input.md"; path.write_text(TEXT)
            output, evidence = study.verify_study(md, meta, transcript, path)
            self.assertEqual(evidence["stats"]["review"], 1)
            self.assertIn("Perlu ditinjau", output)
        draft["overview"][0] = point(basis="external", reference_ids=["invented"])
        with self.assertRaises(ValueError): study.render_study(transcript, draft, [])


if __name__ == "__main__":
    unittest.main()
