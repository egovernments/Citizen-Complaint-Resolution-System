package org.egov.pgr.annotation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.parser.Parser;
import org.jsoup.safety.Safelist;

public class SafeHtmlValidator implements ConstraintValidator<SafeHtml, CharSequence> {

    private Safelist safelist;

    @Override
    public void initialize(SafeHtml annotation) {
        this.safelist = switch (annotation.whitelistType()) {
            case NONE -> Safelist.none();
            case SIMPLE_TEXT -> Safelist.simpleText();
            case BASIC -> Safelist.basic();
            case BASIC_WITH_IMAGES -> Safelist.basicWithImages();
            case RELAXED -> Safelist.relaxed();
        };
    }

    @Override
    public boolean isValid(CharSequence value, ConstraintValidatorContext context) {
        // null is left to @NotNull, matching the annotation this replaces.
        if (value == null) {
            return true;
        }
        String input = value.toString();

        // Deliberately NOT Jsoup.isValid(). isValid() fails a string whenever cleaning
        // changes it at all, including when a bare '<' is merely entity-escaped - so
        // ordinary complaint text like "Water pressure <2 bar since Monday" would be
        // rejected. Here the cleaned output is unescaped before comparing, so escaping
        // alone is tolerated and only genuinely *removed* markup (a stripped <script>,
        // a dropped onerror= attribute) fails the constraint.
        // prettyPrint(false) is required: jsoup's default pretty-printer normalises
        // newlines, tabs and leading/trailing spaces, which would fail any multi-line
        // or padded complaint description even though no markup was removed.
        Document.OutputSettings verbatim = new Document.OutputSettings().prettyPrint(false);
        String cleaned = Parser.unescapeEntities(Jsoup.clean(input, "", safelist, verbatim), true);
        return cleaned.equals(Parser.unescapeEntities(input, true));
    }
}
