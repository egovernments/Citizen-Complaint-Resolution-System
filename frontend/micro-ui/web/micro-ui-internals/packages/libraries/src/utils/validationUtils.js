/**
 * Country-specific mobile number validation utilities
 * Provides validation, formatting, and pattern matching for international mobile numbers
 */

/**
 * Country-specific mobile number validation
 * @param {string} mobileNumber - The mobile number to validate (without country code)
 * @param {string} countryCode - The country code (e.g., '+91', '+1', '+44')
 * @returns {boolean} - True if the mobile number is valid for the given country
 */
export const validateMobileNumber = (mobileNumber, countryCode) => {
  if (!mobileNumber) return false;

  // Remove any spaces, dashes, or parentheses from the mobile number
  const cleanedNumber = mobileNumber.replace(/[\s\-\(\)]/g, '');

  const validations = {
    '+91': /^[6-9][0-9]{9}$/,        // India: 10 digits starting with 6-9
    '+1': /^[2-9][0-9]{9}$/,         // USA/Canada: 10 digits, first digit 2-9
    '+44': /^[1-9][0-9]{9,10}$/,     // UK: 10-11 digits
    '+971': /^[0-9]{8,9}$/,          // UAE: 8-9 digits
    '+61': /^[4][0-9]{8}$/,          // Australia: 9 digits starting with 4
    '+81': /^[0-9]{10}$/,            // Japan: 10 digits
    '+86': /^1[0-9]{10}$/,           // China: 11 digits starting with 1
    '+33': /^[6-7][0-9]{8}$/,        // France: 9 digits starting with 6 or 7
    '+49': /^1[5-7][0-9]{8,9}$/,     // Germany: 10-11 digits starting with 15-17
    '+55': /^[1-9][0-9]{10}$/,       // Brazil: 11 digits
    '+27': /^[6-8][0-9]{8}$/,        // South Africa: 9 digits starting with 6-8
    '+234': /^[7-9][0-9]{9}$/,       // Nigeria: 10 digits starting with 7-9
    '+254': /^[7][0-9]{8}$/,         // Kenya: 9 digits starting with 7
    '+65': /^[8-9][0-9]{7}$/,        // Singapore: 8 digits starting with 8 or 9
    '+60': /^1[0-9]{8,9}$/,          // Malaysia: 9-10 digits starting with 1
    '+92': /^3[0-9]{9}$/,            // Pakistan: 10 digits starting with 3
    '+880': /^1[0-9]{9}$/,           // Bangladesh: 10 digits starting with 1
    '+94': /^[7][0-9]{8}$/,          // Sri Lanka: 9 digits starting with 7
    '+977': /^9[0-9]{9}$/,           // Nepal: 10 digits starting with 9
    '+95': /^[9][0-9]{8,9}$/,        // Myanmar: 9-10 digits starting with 9
  };

  // Use country-specific pattern if available, otherwise use generic pattern
  const pattern = validations[countryCode] || /^[0-9]{8,15}$/;
  return pattern.test(cleanedNumber);
};

/**
 * Format mobile number for display with country-specific formatting
 * @param {string} mobileNumber - The mobile number to format
 * @param {string} countryCode - The country code (e.g., '+91', '+1', '+44')
 * @returns {string} - Formatted mobile number
 */
export const formatMobileNumber = (mobileNumber, countryCode) => {
  if (!mobileNumber) return '';

  // Remove any existing formatting
  const cleanedNumber = mobileNumber.replace(/[\s\-\(\)]/g, '');

  const formatters = {
    '+91': (num) => {
      // India: XXXXX XXXXX (5-5 format)
      if (num.length === 10) {
        return `${num.slice(0, 5)} ${num.slice(5)}`;
      }
      return num;
    },
    '+1': (num) => {
      // USA/Canada: (XXX) XXX-XXXX
      if (num.length === 10) {
        return `(${num.slice(0, 3)}) ${num.slice(3, 6)}-${num.slice(6)}`;
      }
      return num;
    },
    '+44': (num) => {
      // UK: XXXXX XXXXXX or XXXX XXXXXXX
      if (num.length === 10) {
        return `${num.slice(0, 4)} ${num.slice(4)}`;
      } else if (num.length === 11) {
        return `${num.slice(0, 5)} ${num.slice(5)}`;
      }
      return num;
    },
    '+971': (num) => {
      // UAE: XXX XXX XXX or XX XXX XXXX
      if (num.length === 9) {
        return `${num.slice(0, 2)} ${num.slice(2, 5)} ${num.slice(5)}`;
      } else if (num.length === 8) {
        return `${num.slice(0, 2)} ${num.slice(2, 5)} ${num.slice(5)}`;
      }
      return num;
    },
    '+61': (num) => {
      // Australia: XXXX XXX XXX
      if (num.length === 9) {
        return `${num.slice(0, 4)} ${num.slice(4, 7)} ${num.slice(7)}`;
      }
      return num;
    },
    '+81': (num) => {
      // Japan: XXX-XXXX-XXXX
      if (num.length === 10) {
        return `${num.slice(0, 3)}-${num.slice(3, 7)}-${num.slice(7)}`;
      }
      return num;
    },
    '+86': (num) => {
      // China: XXX XXXX XXXX
      if (num.length === 11) {
        return `${num.slice(0, 3)} ${num.slice(3, 7)} ${num.slice(7)}`;
      }
      return num;
    },
  };

  const formatter = formatters[countryCode];
  if (formatter) {
    return formatter(cleanedNumber);
  }

  // Default formatting: Add space every 4 digits
  return cleanedNumber.replace(/(\d{4})(?=\d)/g, '$1 ');
};

/**
 * Get expected mobile number length for a country
 * @param {string} countryCode - The country code (e.g., '+91', '+1', '+44')
 * @returns {number|object} - Expected length or object with min/max for variable lengths
 */
export const getMobileNumberLength = (countryCode) => {
  const lengths = {
    '+91': 10,                    // India
    '+1': 10,                     // USA/Canada
    '+44': { min: 10, max: 11 },  // UK
    '+971': { min: 8, max: 9 },   // UAE
    '+61': 9,                     // Australia
    '+81': 10,                    // Japan
    '+86': 11,                    // China
    '+33': 9,                     // France
    '+49': { min: 10, max: 11 },  // Germany
    '+55': 11,                    // Brazil
    '+27': 9,                     // South Africa
    '+234': 10,                   // Nigeria
    '+254': 9,                    // Kenya
    '+65': 8,                     // Singapore
    '+60': { min: 9, max: 10 },   // Malaysia
    '+92': 10,                    // Pakistan
    '+880': 10,                   // Bangladesh
    '+94': 9,                     // Sri Lanka
    '+977': 10,                   // Nepal
    '+95': { min: 9, max: 10 },   // Myanmar
  };

  return lengths[countryCode] || { min: 8, max: 15 };
};

/**
 * Get validation pattern (regex) for a country
 * @param {string} countryCode - The country code (e.g., '+91', '+1', '+44')
 * @returns {RegExp} - Regular expression pattern for validation
 */
export const getValidationPattern = (countryCode) => {
  const patterns = {
    '+91': /^[6-9][0-9]{9}$/,
    '+1': /^[2-9][0-9]{9}$/,
    '+44': /^[1-9][0-9]{9,10}$/,
    '+971': /^[0-9]{8,9}$/,
    '+61': /^[4][0-9]{8}$/,
    '+81': /^[0-9]{10}$/,
    '+86': /^1[0-9]{10}$/,
    '+33': /^[6-7][0-9]{8}$/,
    '+49': /^1[5-7][0-9]{8,9}$/,
    '+55': /^[1-9][0-9]{10}$/,
    '+27': /^[6-8][0-9]{8}$/,
    '+234': /^[7-9][0-9]{9}$/,
    '+254': /^[7][0-9]{8}$/,
    '+65': /^[8-9][0-9]{7}$/,
    '+60': /^1[0-9]{8,9}$/,
    '+92': /^3[0-9]{9}$/,
    '+880': /^1[0-9]{9}$/,
    '+94': /^[7][0-9]{8}$/,
    '+977': /^9[0-9]{9}$/,
    '+95': /^[9][0-9]{8,9}$/,
  };

  return patterns[countryCode] || /^[0-9]{8,15}$/;
};

/**
 * Get validation error message for a country
 * @param {string} countryCode - The country code (e.g., '+91', '+1', '+44')
 * @returns {string} - User-friendly error message
 */
export const getValidationErrorMessage = (countryCode) => {
  const messages = {
    '+91': 'Mobile number must be 10 digits starting with 6-9',
    '+1': 'Mobile number must be 10 digits',
    '+44': 'Mobile number must be 10-11 digits',
    '+971': 'Mobile number must be 8-9 digits',
    '+61': 'Mobile number must be 9 digits starting with 4',
    '+81': 'Mobile number must be 10 digits',
    '+86': 'Mobile number must be 11 digits starting with 1',
    '+33': 'Mobile number must be 9 digits starting with 6 or 7',
    '+49': 'Mobile number must be 10-11 digits starting with 15-17',
    '+55': 'Mobile number must be 11 digits',
    '+27': 'Mobile number must be 9 digits starting with 6-8',
    '+234': 'Mobile number must be 10 digits starting with 7-9',
    '+254': 'Mobile number must be 9 digits starting with 7',
    '+65': 'Mobile number must be 8 digits starting with 8 or 9',
    '+60': 'Mobile number must be 9-10 digits starting with 1',
    '+92': 'Mobile number must be 10 digits starting with 3',
    '+880': 'Mobile number must be 10 digits starting with 1',
    '+94': 'Mobile number must be 9 digits starting with 7',
    '+977': 'Mobile number must be 10 digits starting with 9',
    '+95': 'Mobile number must be 9-10 digits starting with 9',
  };

  return messages[countryCode] || 'Mobile number must be 8-15 digits';
};

/**
 * Validate and clean mobile number (remove formatting)
 * @param {string} mobileNumber - The mobile number to clean
 * @returns {string} - Cleaned mobile number (digits only)
 */
export const cleanMobileNumber = (mobileNumber) => {
  if (!mobileNumber) return '';
  return mobileNumber.replace(/[\s\-\(\)]/g, '');
};

/**
 * Check if mobile number is complete based on country code
 * @param {string} mobileNumber - The mobile number to check
 * @param {string} countryCode - The country code
 * @returns {boolean} - True if the number is complete
 */
export const isMobileNumberComplete = (mobileNumber, countryCode) => {
  const cleanedNumber = cleanMobileNumber(mobileNumber);
  const expectedLength = getMobileNumberLength(countryCode);

  if (typeof expectedLength === 'number') {
    return cleanedNumber.length === expectedLength;
  } else if (expectedLength.min && expectedLength.max) {
    return cleanedNumber.length >= expectedLength.min && cleanedNumber.length <= expectedLength.max;
  }

  return false;
};

/**
 * Get placeholder text for mobile input based on country
 * @param {string} countryCode - The country code
 * @returns {string} - Placeholder text
 */
export const getMobileNumberPlaceholder = (countryCode) => {
  const placeholders = {
    '+91': 'Enter 10 digit mobile number',
    '+1': 'Enter 10 digit mobile number',
    '+44': 'Enter mobile number',
    '+971': 'Enter mobile number',
    '+61': 'Enter 9 digit mobile number',
    '+81': 'Enter 10 digit mobile number',
    '+86': 'Enter 11 digit mobile number',
    '+33': 'Enter 9 digit mobile number',
    '+49': 'Enter mobile number',
    '+55': 'Enter 11 digit mobile number',
    '+27': 'Enter 9 digit mobile number',
    '+234': 'Enter 10 digit mobile number',
    '+254': 'Enter 9 digit mobile number',
    '+65': 'Enter 8 digit mobile number',
    '+60': 'Enter mobile number',
    '+92': 'Enter 10 digit mobile number',
    '+880': 'Enter 10 digit mobile number',
    '+94': 'Enter 9 digit mobile number',
    '+977': 'Enter 10 digit mobile number',
    '+95': 'Enter mobile number',
  };

  return placeholders[countryCode] || 'Enter mobile number';
};
