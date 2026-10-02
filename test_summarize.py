import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from summarize import (
    collect_claims,
    make_chunks,
    parse_transcript,
    render_draft,
    render_verification,
    write_draft,
)


HEADER = 'title: "Kajian"\nsource: "https://example.com/video"\n## Transcript\n'


class TranscriptParserTests(unittest.TestCase):
    def test_plain_text_with_optional_metadata_and_stable_passage_ids(self):
        raw = "Kalimat pertama terputus\nnamun tetap disimpan.\n\nParagraf kedua."
        parsed = parse_transcript(raw, title="Nama berkas")
        self.assertEqual(parsed["title"], "Nama berkas")
        self.assertEqual(parsed["source"], "")
        self.assertEqual(parsed["format"], "plain")
        self.assertEqual([p["id"] for p in parsed["passages"]], ["P001", "P002"])
        self.assertEqual([p["line"] for p in parsed["passages"]], [1, 4])
        self.assertEqual(parsed["passages"][0]["text"], raw.split("\n\n")[0])
        self.assertTrue(all(p["timestamp"] is None and p["seconds"] is None for p in parsed["passages"]))
        self.assertEqual(parse_transcript(HEADER + raw)["passages"][1]["id"], "P002")
        self.assertEqual(parse_transcript('---\ntitle: "Judul"\n---\n'+raw)["title"], "Judul")
        self.assertEqual(parse_transcript("2:183 merupakan rujukan ayat.")["format"], "plain")
        with self.assertRaisesRegex(ValueError, "no text"):
            parse_transcript("\n\n ")

    def test_long_plain_text_chunks_preserve_words_and_reject_mixed_input(self):
        raw = " ".join(f"kata{i}" for i in range(1600))
        passages = parse_transcript(raw)["passages"]
        self.assertEqual(" ".join(p["text"] for p in passages), raw)
        self.assertTrue(all(len(p["text"]) <= 1600 for p in passages))
        chunks = make_chunks(passages)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all("None" not in c["text"] for c in chunks))
        with self.assertRaisesRegex(ValueError, "malformed transcript entry"):
            parse_transcript(HEADER + "**0:01** · Awal\n\nTeks tanpa waktu.")

    def test_timestamp_formats_and_duplicate_ids(self):
        data = parse_transcript(
            HEADER + "**0:01** · Awal\n**1:02:03** · Lanjut\n**1:02:03** · Masih lanjut\n"
        )["passages"]
        self.assertEqual([p["seconds"] for p in data], [1, 3723, 3723])
        self.assertEqual([p["id"] for p in data], ["T000001", "T003723", "T003723-02"])
        self.assertEqual([p["line"] for p in data], [4, 5, 6])

    def test_rejects_bad_entries_and_order(self):
        for body, message in (
            ("**1:60** · Salah", "invalid timestamp"),
            ("**0:10** · Awal\n**0:09** · Mundur", "out of order"),
            ("**0:01** tanpa pemisah", "malformed transcript entry"),
        ):
            with self.subTest(body=body), self.assertRaisesRegex(ValueError, message):
                parse_transcript(HEADER + body)

    def test_draft_uses_only_known_source_ids_and_preserves_existing_file(self):
        transcript = parse_transcript(HEADER + "**0:01** · Awal\n**2:01** · Lanjut\n")
        self.assertEqual(len(make_chunks(transcript["passages"])), 2)
        point = {"text": "Pemateri membuka kajian.", "source_ids": ["T000001"]}
        draft = {
            "overview": [point],
            "sections": [{"title": "Pembukaan", "points": [point]}],
            "qa": [{"question": "Apa pembukaannya?", "answer": "Awal.", "source_ids": ["T000001"]}],
            "review_notes": [],
        }
        rendered = render_draft(transcript, draft)
        self.assertIn("https://example.com/video?t=1s", rendered)
        with TemporaryDirectory() as directory:
            output = Path(directory) / "notes.md"
            write_draft(output, rendered, False)
            with self.assertRaises(FileExistsError):
                write_draft(output, "replacement", False)
            self.assertEqual(output.read_text(), rendered)
        draft["overview"][0] = {"text": "Salah", "source_ids": ["missing"]}
        with self.assertRaisesRegex(ValueError, "unknown source passage"):
            render_draft(transcript, draft)

    def test_verification_flags_claims_and_can_be_repeated(self):
        transcript = parse_transcript(HEADER + "**0:01** · Hanya dua bentuk dijelaskan.\n")
        point = {"text": "Semua 21 bentuk dijelaskan.", "source_ids": ["T000001"]}
        draft = {
            "overview": [point],
            "sections": [{"title": "Isi", "points": [point]}],
            "qa": [{"question": "Berapa?", "answer": "Dua.", "source_ids": ["T000001"]}],
            "review_notes": [],
        }
        lines, claims = collect_claims(render_draft(transcript, draft), transcript)
        checked = [
            {**claim, "verdict": "contradicts" if i == 0 else "supports", "confidence": 0.95}
            for i, claim in enumerate(claims)
        ]
        verified = render_verification(lines, "jev-test", checked)
        self.assertIn("**[Bertentangan dengan sumber]**", verified)
        self.assertIn("Didukung oleh kutipan: 3 dari 4 poin", verified)
        self.assertEqual(len(collect_claims(verified, transcript)[1]), 4)


if __name__ == "__main__":
    unittest.main()
