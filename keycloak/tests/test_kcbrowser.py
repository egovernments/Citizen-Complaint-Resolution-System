import unittest
from kcbrowser import Page


class FormSubmissionTest(unittest.TestCase):
    def test_does_not_submit_both_continue_and_cancel(self):
        page = Page("http://localhost/form", 200, '''
          <form action="/continue" method="post">
            <input type="hidden" name="state" value="test-state">
            <input type="submit" name="continue" value="Continue">
            <input type="submit" name="cancel-aia" value="Cancel">
          </form>''')
        action, fields = page.forms()[0]
        self.assertEqual(action, "/continue")
        self.assertEqual(fields, {"state": "test-state"})
        fields["continue"] = "Continue"
        self.assertNotIn("cancel-aia", fields)

    def test_keeps_hidden_and_checked_fields_and_decodes_entities(self):
        page = Page("http://localhost/form", 200, '''
          <form action="/next?a=1&amp;b=2">
            <input type="hidden" name="value" value="a&amp;b">
            <input type="checkbox" name="yes" value="on" checked>
            <input type="checkbox" name="no" value="on">
          </form>''')
        self.assertEqual(page.forms(), [("/next?a=1&b=2", {"value": "a&b", "yes": "on"})])


if __name__ == "__main__":
    unittest.main()
