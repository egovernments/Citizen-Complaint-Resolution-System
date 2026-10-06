const config = require('../../env-variables');
const messages = require('./shell-messages');
const localisationService = require('../util/localisation-service');


const LOCALE_KEY = /^[a-z]{2}_[A-Z]{2}$/;

// Every locale that has a fallback literal in EVERY message of this journey.
//
// This replaces a proxy: the offered set used to be the key set of the welcome
// bundle alone, so adding a locale to that one message would offer it while
// every other prompt still came out in English. Intersecting across all bundles
// says what was actually meant.
function localesWithFullFallback() {
  const sets = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    const keys = Object.keys(node);
    const locales = keys.filter((key) => LOCALE_KEY.test(key));
    if (locales.length) {
      sets.push(new Set(locales));
      return;
    }
    keys.forEach((key) => walk(node[key]));
  })(messages);

  if (!sets.length) return new Set();
  return sets.reduce((covered, next) => new Set([...covered].filter((l) => next.has(l))));
}

// The platform decides which locales exist and how they are labelled; the
// bundles decide which of those the bot can actually speak. Offer the
// intersection, and never offer nothing.
function offeredLocales() {
  const speakable = localesWithFullFallback();
  const declared = localisationService.getLocales();
  const offered = declared.filter((l) => speakable.has(l.value));
  if (offered.length) return offered;

  // No overlap: the platform is unreachable, or declares locales no bundle can
  // serve. Offer what the bundles CAN serve, then the configured default — a
  // literal here would be the language assumption this module exists to remove.
  const labelFor = (value) => {
    const locale = declared.find((item) => item.value === value);
    return locale ? locale.label : value;
  };

  if (speakable.size) {
    return [...speakable].map((value) => ({
      value,
      label: labelFor(value),
    }));
  }

  const defaultLocale = config.defaultLocale;
  return [{
    value: defaultLocale,
    label: labelFor(defaultLocale),
  }];
}


module.exports = { offeredLocales, localesWithFullFallback };
