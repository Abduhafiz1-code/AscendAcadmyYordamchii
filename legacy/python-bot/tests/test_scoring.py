"""Ball hisoblash dvigateli testlari."""
import unittest

from bot.scoring import check_answer, normalize, score_from_ratio


class NormalizeTests(unittest.TestCase):
    def test_apostrophes_and_case(self):
        self.assertEqual(normalize("To‘rtburchak  YUZASI"), "to'rtburchak yuzasi")

    def test_punctuation_removed(self):
        self.assertEqual(normalize("S = a * b!"), "s a b")

    def test_empty(self):
        self.assertEqual(normalize(None), "")
        self.assertEqual(normalize("   "), "")


class ScoreTests(unittest.TestCase):
    def test_bounds(self):
        self.assertEqual(score_from_ratio(0), 0.5)
        self.assertEqual(score_from_ratio(1), 10.0)
        self.assertGreaterEqual(score_from_ratio(0.001), 0.5)
        self.assertLessEqual(score_from_ratio(0.999), 10.0)

    def test_half_step(self):
        for ratio in (0.1, 0.23, 0.37, 0.51, 0.66, 0.84, 0.98):
            score = score_from_ratio(ratio)
            self.assertEqual(round(score * 2) / 2, score)


class CheckAnswerTests(unittest.TestCase):
    def test_exact_numeric(self):
        result = check_answer("4", "4|to'rt|4 ta")
        self.assertEqual(result.ratio, 1.0)
        self.assertEqual(result.score, 10.0)

    def test_numeric_is_not_substring(self):
        result = check_answer("14", "4")
        self.assertEqual(result.ratio, 0.0)

    def test_alternatives_pick_best(self):
        result = check_answer("to'rt", "4|to'rt|4 ta")
        self.assertEqual(result.ratio, 1.0)

    def test_all_keywords_required(self):
        result = check_answer("fotosintez jarayoni xlorofill yordamida", "fotosintez+xlorofill")
        self.assertEqual(result.ratio, 1.0)

    def test_partial_keywords(self):
        result = check_answer("fotosintez", "fotosintez+xlorofill")
        self.assertEqual(result.ratio, 0.5)
        self.assertEqual(result.score, 5.0)

    def test_empty_answer(self):
        result = check_answer("", "4")
        self.assertEqual(result.score, 0.0)

    def test_no_key(self):
        result = check_answer("javob", "")
        self.assertEqual(result.score, 0.0)

    def test_extra_words_do_not_break(self):
        result = check_answer("Menimcha to'g'ri javob 4 bo'ladi", "4")
        self.assertEqual(result.ratio, 1.0)


if __name__ == "__main__":
    unittest.main()
