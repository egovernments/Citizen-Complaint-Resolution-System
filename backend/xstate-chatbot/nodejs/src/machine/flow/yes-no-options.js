const dialog = require('../util/dialog');

// Yes/No prompts print their choices inside their own prompt text, so the
// citizen reads "Submeter" while the option value is 'Yes' — typing the word
// they were shown hit the retry path, and only the digit worked. Labels are
// resolved against the citizen's locale at ask time.
//
// The aliases are accepted on every one of them: asked a yes-or-no question, a
// citizen types "sim" whatever the options happen to be called.
const YES_ALIASES = ['sim', 'yes', 's', 'y'];
const NO_ALIASES = ['nao', 'não', 'no', 'n'];

function yesNoOptions(yesBundle, noBundle) {
  return (context) => [
    { value: 'Yes', label: dialog.get_message(yesBundle, context.user.locale), aliases: YES_ALIASES },
    { value: 'No', label: dialog.get_message(noBundle, context.user.locale), aliases: NO_ALIASES },
  ];
}

module.exports = { yesNoOptions };
