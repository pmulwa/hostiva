/**
 * Comprehensive ISO-3166 country list with E.164 dialing codes.
 * Used by user management forms for country picker + auto phone-prefix.
 */
export interface Country {
  /** ISO-3166 alpha-2 code (uppercase) */
  code: string;
  /** Display name in English */
  name: string;
  /** International dialing code without the leading "+" */
  dial: string;
  /** Emoji flag */
  flag: string;
}

export const COUNTRIES: Country[] = [
  { code: 'AF', name: 'Afghanistan', dial: '93', flag: '🇦🇫' },
  { code: 'AL', name: 'Albania', dial: '355', flag: '🇦🇱' },
  { code: 'DZ', name: 'Algeria', dial: '213', flag: '🇩🇿' },
  { code: 'AS', name: 'American Samoa', dial: '1684', flag: '🇦🇸' },
  { code: 'AD', name: 'Andorra', dial: '376', flag: '🇦🇩' },
  { code: 'AO', name: 'Angola', dial: '244', flag: '🇦🇴' },
  { code: 'AI', name: 'Anguilla', dial: '1264', flag: '🇦🇮' },
  { code: 'AG', name: 'Antigua and Barbuda', dial: '1268', flag: '🇦🇬' },
  { code: 'AR', name: 'Argentina', dial: '54', flag: '🇦🇷' },
  { code: 'AM', name: 'Armenia', dial: '374', flag: '🇦🇲' },
  { code: 'AW', name: 'Aruba', dial: '297', flag: '🇦🇼' },
  { code: 'AU', name: 'Australia', dial: '61', flag: '🇦🇺' },
  { code: 'AT', name: 'Austria', dial: '43', flag: '🇦🇹' },
  { code: 'AZ', name: 'Azerbaijan', dial: '994', flag: '🇦🇿' },
  { code: 'BS', name: 'Bahamas', dial: '1242', flag: '🇧🇸' },
  { code: 'BH', name: 'Bahrain', dial: '973', flag: '🇧🇭' },
  { code: 'BD', name: 'Bangladesh', dial: '880', flag: '🇧🇩' },
  { code: 'BB', name: 'Barbados', dial: '1246', flag: '🇧🇧' },
  { code: 'BY', name: 'Belarus', dial: '375', flag: '🇧🇾' },
  { code: 'BE', name: 'Belgium', dial: '32', flag: '🇧🇪' },
  { code: 'BZ', name: 'Belize', dial: '501', flag: '🇧🇿' },
  { code: 'BJ', name: 'Benin', dial: '229', flag: '🇧🇯' },
  { code: 'BM', name: 'Bermuda', dial: '1441', flag: '🇧🇲' },
  { code: 'BT', name: 'Bhutan', dial: '975', flag: '🇧🇹' },
  { code: 'BO', name: 'Bolivia', dial: '591', flag: '🇧🇴' },
  { code: 'BA', name: 'Bosnia and Herzegovina', dial: '387', flag: '🇧🇦' },
  { code: 'BW', name: 'Botswana', dial: '267', flag: '🇧🇼' },
  { code: 'BR', name: 'Brazil', dial: '55', flag: '🇧🇷' },
  { code: 'IO', name: 'British Indian Ocean Territory', dial: '246', flag: '🇮🇴' },
  { code: 'VG', name: 'British Virgin Islands', dial: '1284', flag: '🇻🇬' },
  { code: 'BN', name: 'Brunei', dial: '673', flag: '🇧🇳' },
  { code: 'BG', name: 'Bulgaria', dial: '359', flag: '🇧🇬' },
  { code: 'BF', name: 'Burkina Faso', dial: '226', flag: '🇧🇫' },
  { code: 'BI', name: 'Burundi', dial: '257', flag: '🇧🇮' },
  { code: 'KH', name: 'Cambodia', dial: '855', flag: '🇰🇭' },
  { code: 'CM', name: 'Cameroon', dial: '237', flag: '🇨🇲' },
  { code: 'CA', name: 'Canada', dial: '1', flag: '🇨🇦' },
  { code: 'CV', name: 'Cape Verde', dial: '238', flag: '🇨🇻' },
  { code: 'KY', name: 'Cayman Islands', dial: '1345', flag: '🇰🇾' },
  { code: 'CF', name: 'Central African Republic', dial: '236', flag: '🇨🇫' },
  { code: 'TD', name: 'Chad', dial: '235', flag: '🇹🇩' },
  { code: 'CL', name: 'Chile', dial: '56', flag: '🇨🇱' },
  { code: 'CN', name: 'China', dial: '86', flag: '🇨🇳' },
  { code: 'CX', name: 'Christmas Island', dial: '61', flag: '🇨🇽' },
  { code: 'CC', name: 'Cocos Islands', dial: '61', flag: '🇨🇨' },
  { code: 'CO', name: 'Colombia', dial: '57', flag: '🇨🇴' },
  { code: 'KM', name: 'Comoros', dial: '269', flag: '🇰🇲' },
  { code: 'CK', name: 'Cook Islands', dial: '682', flag: '🇨🇰' },
  { code: 'CR', name: 'Costa Rica', dial: '506', flag: '🇨🇷' },
  { code: 'HR', name: 'Croatia', dial: '385', flag: '🇭🇷' },
  { code: 'CU', name: 'Cuba', dial: '53', flag: '🇨🇺' },
  { code: 'CW', name: 'Curaçao', dial: '599', flag: '🇨🇼' },
  { code: 'CY', name: 'Cyprus', dial: '357', flag: '🇨🇾' },
  { code: 'CZ', name: 'Czech Republic', dial: '420', flag: '🇨🇿' },
  { code: 'CD', name: 'Democratic Republic of the Congo', dial: '243', flag: '🇨🇩' },
  { code: 'DK', name: 'Denmark', dial: '45', flag: '🇩🇰' },
  { code: 'DJ', name: 'Djibouti', dial: '253', flag: '🇩🇯' },
  { code: 'DM', name: 'Dominica', dial: '1767', flag: '🇩🇲' },
  { code: 'DO', name: 'Dominican Republic', dial: '1809', flag: '🇩🇴' },
  { code: 'EC', name: 'Ecuador', dial: '593', flag: '🇪🇨' },
  { code: 'EG', name: 'Egypt', dial: '20', flag: '🇪🇬' },
  { code: 'SV', name: 'El Salvador', dial: '503', flag: '🇸🇻' },
  { code: 'GQ', name: 'Equatorial Guinea', dial: '240', flag: '🇬🇶' },
  { code: 'ER', name: 'Eritrea', dial: '291', flag: '🇪🇷' },
  { code: 'EE', name: 'Estonia', dial: '372', flag: '🇪🇪' },
  { code: 'SZ', name: 'Eswatini', dial: '268', flag: '🇸🇿' },
  { code: 'ET', name: 'Ethiopia', dial: '251', flag: '🇪🇹' },
  { code: 'FK', name: 'Falkland Islands', dial: '500', flag: '🇫🇰' },
  { code: 'FO', name: 'Faroe Islands', dial: '298', flag: '🇫🇴' },
  { code: 'FJ', name: 'Fiji', dial: '679', flag: '🇫🇯' },
  { code: 'FI', name: 'Finland', dial: '358', flag: '🇫🇮' },
  { code: 'FR', name: 'France', dial: '33', flag: '🇫🇷' },
  { code: 'GF', name: 'French Guiana', dial: '594', flag: '🇬🇫' },
  { code: 'PF', name: 'French Polynesia', dial: '689', flag: '🇵🇫' },
  { code: 'GA', name: 'Gabon', dial: '241', flag: '🇬🇦' },
  { code: 'GM', name: 'Gambia', dial: '220', flag: '🇬🇲' },
  { code: 'GE', name: 'Georgia', dial: '995', flag: '🇬🇪' },
  { code: 'DE', name: 'Germany', dial: '49', flag: '🇩🇪' },
  { code: 'GH', name: 'Ghana', dial: '233', flag: '🇬🇭' },
  { code: 'GI', name: 'Gibraltar', dial: '350', flag: '🇬🇮' },
  { code: 'GR', name: 'Greece', dial: '30', flag: '🇬🇷' },
  { code: 'GL', name: 'Greenland', dial: '299', flag: '🇬🇱' },
  { code: 'GD', name: 'Grenada', dial: '1473', flag: '🇬🇩' },
  { code: 'GP', name: 'Guadeloupe', dial: '590', flag: '🇬🇵' },
  { code: 'GU', name: 'Guam', dial: '1671', flag: '🇬🇺' },
  { code: 'GT', name: 'Guatemala', dial: '502', flag: '🇬🇹' },
  { code: 'GG', name: 'Guernsey', dial: '44', flag: '🇬🇬' },
  { code: 'GN', name: 'Guinea', dial: '224', flag: '🇬🇳' },
  { code: 'GW', name: 'Guinea-Bissau', dial: '245', flag: '🇬🇼' },
  { code: 'GY', name: 'Guyana', dial: '592', flag: '🇬🇾' },
  { code: 'HT', name: 'Haiti', dial: '509', flag: '🇭🇹' },
  { code: 'HN', name: 'Honduras', dial: '504', flag: '🇭🇳' },
  { code: 'HK', name: 'Hong Kong', dial: '852', flag: '🇭🇰' },
  { code: 'HU', name: 'Hungary', dial: '36', flag: '🇭🇺' },
  { code: 'IS', name: 'Iceland', dial: '354', flag: '🇮🇸' },
  { code: 'IN', name: 'India', dial: '91', flag: '🇮🇳' },
  { code: 'ID', name: 'Indonesia', dial: '62', flag: '🇮🇩' },
  { code: 'IR', name: 'Iran', dial: '98', flag: '🇮🇷' },
  { code: 'IQ', name: 'Iraq', dial: '964', flag: '🇮🇶' },
  { code: 'IE', name: 'Ireland', dial: '353', flag: '🇮🇪' },
  { code: 'IM', name: 'Isle of Man', dial: '44', flag: '🇮🇲' },
  { code: 'IL', name: 'Israel', dial: '972', flag: '🇮🇱' },
  { code: 'IT', name: 'Italy', dial: '39', flag: '🇮🇹' },
  { code: 'CI', name: 'Ivory Coast', dial: '225', flag: '🇨🇮' },
  { code: 'JM', name: 'Jamaica', dial: '1876', flag: '🇯🇲' },
  { code: 'JP', name: 'Japan', dial: '81', flag: '🇯🇵' },
  { code: 'JE', name: 'Jersey', dial: '44', flag: '🇯🇪' },
  { code: 'JO', name: 'Jordan', dial: '962', flag: '🇯🇴' },
  { code: 'KZ', name: 'Kazakhstan', dial: '7', flag: '🇰🇿' },
  { code: 'KE', name: 'Kenya', dial: '254', flag: '🇰🇪' },
  { code: 'KI', name: 'Kiribati', dial: '686', flag: '🇰🇮' },
  { code: 'XK', name: 'Kosovo', dial: '383', flag: '🇽🇰' },
  { code: 'KW', name: 'Kuwait', dial: '965', flag: '🇰🇼' },
  { code: 'KG', name: 'Kyrgyzstan', dial: '996', flag: '🇰🇬' },
  { code: 'LA', name: 'Laos', dial: '856', flag: '🇱🇦' },
  { code: 'LV', name: 'Latvia', dial: '371', flag: '🇱🇻' },
  { code: 'LB', name: 'Lebanon', dial: '961', flag: '🇱🇧' },
  { code: 'LS', name: 'Lesotho', dial: '266', flag: '🇱🇸' },
  { code: 'LR', name: 'Liberia', dial: '231', flag: '🇱🇷' },
  { code: 'LY', name: 'Libya', dial: '218', flag: '🇱🇾' },
  { code: 'LI', name: 'Liechtenstein', dial: '423', flag: '🇱🇮' },
  { code: 'LT', name: 'Lithuania', dial: '370', flag: '🇱🇹' },
  { code: 'LU', name: 'Luxembourg', dial: '352', flag: '🇱🇺' },
  { code: 'MO', name: 'Macau', dial: '853', flag: '🇲🇴' },
  { code: 'MG', name: 'Madagascar', dial: '261', flag: '🇲🇬' },
  { code: 'MW', name: 'Malawi', dial: '265', flag: '🇲🇼' },
  { code: 'MY', name: 'Malaysia', dial: '60', flag: '🇲🇾' },
  { code: 'MV', name: 'Maldives', dial: '960', flag: '🇲🇻' },
  { code: 'ML', name: 'Mali', dial: '223', flag: '🇲🇱' },
  { code: 'MT', name: 'Malta', dial: '356', flag: '🇲🇹' },
  { code: 'MH', name: 'Marshall Islands', dial: '692', flag: '🇲🇭' },
  { code: 'MQ', name: 'Martinique', dial: '596', flag: '🇲🇶' },
  { code: 'MR', name: 'Mauritania', dial: '222', flag: '🇲🇷' },
  { code: 'MU', name: 'Mauritius', dial: '230', flag: '🇲🇺' },
  { code: 'YT', name: 'Mayotte', dial: '262', flag: '🇾🇹' },
  { code: 'MX', name: 'Mexico', dial: '52', flag: '🇲🇽' },
  { code: 'FM', name: 'Micronesia', dial: '691', flag: '🇫🇲' },
  { code: 'MD', name: 'Moldova', dial: '373', flag: '🇲🇩' },
  { code: 'MC', name: 'Monaco', dial: '377', flag: '🇲🇨' },
  { code: 'MN', name: 'Mongolia', dial: '976', flag: '🇲🇳' },
  { code: 'ME', name: 'Montenegro', dial: '382', flag: '🇲🇪' },
  { code: 'MS', name: 'Montserrat', dial: '1664', flag: '🇲🇸' },
  { code: 'MA', name: 'Morocco', dial: '212', flag: '🇲🇦' },
  { code: 'MZ', name: 'Mozambique', dial: '258', flag: '🇲🇿' },
  { code: 'MM', name: 'Myanmar', dial: '95', flag: '🇲🇲' },
  { code: 'NA', name: 'Namibia', dial: '264', flag: '🇳🇦' },
  { code: 'NR', name: 'Nauru', dial: '674', flag: '🇳🇷' },
  { code: 'NP', name: 'Nepal', dial: '977', flag: '🇳🇵' },
  { code: 'NL', name: 'Netherlands', dial: '31', flag: '🇳🇱' },
  { code: 'NC', name: 'New Caledonia', dial: '687', flag: '🇳🇨' },
  { code: 'NZ', name: 'New Zealand', dial: '64', flag: '🇳🇿' },
  { code: 'NI', name: 'Nicaragua', dial: '505', flag: '🇳🇮' },
  { code: 'NE', name: 'Niger', dial: '227', flag: '🇳🇪' },
  { code: 'NG', name: 'Nigeria', dial: '234', flag: '🇳🇬' },
  { code: 'NU', name: 'Niue', dial: '683', flag: '🇳🇺' },
  { code: 'KP', name: 'North Korea', dial: '850', flag: '🇰🇵' },
  { code: 'MK', name: 'North Macedonia', dial: '389', flag: '🇲🇰' },
  { code: 'MP', name: 'Northern Mariana Islands', dial: '1670', flag: '🇲🇵' },
  { code: 'NO', name: 'Norway', dial: '47', flag: '🇳🇴' },
  { code: 'OM', name: 'Oman', dial: '968', flag: '🇴🇲' },
  { code: 'PK', name: 'Pakistan', dial: '92', flag: '🇵🇰' },
  { code: 'PW', name: 'Palau', dial: '680', flag: '🇵🇼' },
  { code: 'PS', name: 'Palestine', dial: '970', flag: '🇵🇸' },
  { code: 'PA', name: 'Panama', dial: '507', flag: '🇵🇦' },
  { code: 'PG', name: 'Papua New Guinea', dial: '675', flag: '🇵🇬' },
  { code: 'PY', name: 'Paraguay', dial: '595', flag: '🇵🇾' },
  { code: 'PE', name: 'Peru', dial: '51', flag: '🇵🇪' },
  { code: 'PH', name: 'Philippines', dial: '63', flag: '🇵🇭' },
  { code: 'PL', name: 'Poland', dial: '48', flag: '🇵🇱' },
  { code: 'PT', name: 'Portugal', dial: '351', flag: '🇵🇹' },
  { code: 'PR', name: 'Puerto Rico', dial: '1787', flag: '🇵🇷' },
  { code: 'QA', name: 'Qatar', dial: '974', flag: '🇶🇦' },
  { code: 'CG', name: 'Republic of the Congo', dial: '242', flag: '🇨🇬' },
  { code: 'RE', name: 'Réunion', dial: '262', flag: '🇷🇪' },
  { code: 'RO', name: 'Romania', dial: '40', flag: '🇷🇴' },
  { code: 'RU', name: 'Russia', dial: '7', flag: '🇷🇺' },
  { code: 'RW', name: 'Rwanda', dial: '250', flag: '🇷🇼' },
  { code: 'BL', name: 'Saint Barthélemy', dial: '590', flag: '🇧🇱' },
  { code: 'SH', name: 'Saint Helena', dial: '290', flag: '🇸🇭' },
  { code: 'KN', name: 'Saint Kitts and Nevis', dial: '1869', flag: '🇰🇳' },
  { code: 'LC', name: 'Saint Lucia', dial: '1758', flag: '🇱🇨' },
  { code: 'MF', name: 'Saint Martin', dial: '590', flag: '🇲🇫' },
  { code: 'PM', name: 'Saint Pierre and Miquelon', dial: '508', flag: '🇵🇲' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', dial: '1784', flag: '🇻🇨' },
  { code: 'WS', name: 'Samoa', dial: '685', flag: '🇼🇸' },
  { code: 'SM', name: 'San Marino', dial: '378', flag: '🇸🇲' },
  { code: 'ST', name: 'São Tomé and Príncipe', dial: '239', flag: '🇸🇹' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966', flag: '🇸🇦' },
  { code: 'SN', name: 'Senegal', dial: '221', flag: '🇸🇳' },
  { code: 'RS', name: 'Serbia', dial: '381', flag: '🇷🇸' },
  { code: 'SC', name: 'Seychelles', dial: '248', flag: '🇸🇨' },
  { code: 'SL', name: 'Sierra Leone', dial: '232', flag: '🇸🇱' },
  { code: 'SG', name: 'Singapore', dial: '65', flag: '🇸🇬' },
  { code: 'SX', name: 'Sint Maarten', dial: '1721', flag: '🇸🇽' },
  { code: 'SK', name: 'Slovakia', dial: '421', flag: '🇸🇰' },
  { code: 'SI', name: 'Slovenia', dial: '386', flag: '🇸🇮' },
  { code: 'SB', name: 'Solomon Islands', dial: '677', flag: '🇸🇧' },
  { code: 'SO', name: 'Somalia', dial: '252', flag: '🇸🇴' },
  { code: 'ZA', name: 'South Africa', dial: '27', flag: '🇿🇦' },
  { code: 'KR', name: 'South Korea', dial: '82', flag: '🇰🇷' },
  { code: 'SS', name: 'South Sudan', dial: '211', flag: '🇸🇸' },
  { code: 'ES', name: 'Spain', dial: '34', flag: '🇪🇸' },
  { code: 'LK', name: 'Sri Lanka', dial: '94', flag: '🇱🇰' },
  { code: 'SD', name: 'Sudan', dial: '249', flag: '🇸🇩' },
  { code: 'SR', name: 'Suriname', dial: '597', flag: '🇸🇷' },
  { code: 'SE', name: 'Sweden', dial: '46', flag: '🇸🇪' },
  { code: 'CH', name: 'Switzerland', dial: '41', flag: '🇨🇭' },
  { code: 'SY', name: 'Syria', dial: '963', flag: '🇸🇾' },
  { code: 'TW', name: 'Taiwan', dial: '886', flag: '🇹🇼' },
  { code: 'TJ', name: 'Tajikistan', dial: '992', flag: '🇹🇯' },
  { code: 'TZ', name: 'Tanzania', dial: '255', flag: '🇹🇿' },
  { code: 'TH', name: 'Thailand', dial: '66', flag: '🇹🇭' },
  { code: 'TL', name: 'Timor-Leste', dial: '670', flag: '🇹🇱' },
  { code: 'TG', name: 'Togo', dial: '228', flag: '🇹🇬' },
  { code: 'TK', name: 'Tokelau', dial: '690', flag: '🇹🇰' },
  { code: 'TO', name: 'Tonga', dial: '676', flag: '🇹🇴' },
  { code: 'TT', name: 'Trinidad and Tobago', dial: '1868', flag: '🇹🇹' },
  { code: 'TN', name: 'Tunisia', dial: '216', flag: '🇹🇳' },
  { code: 'TR', name: 'Turkey', dial: '90', flag: '🇹🇷' },
  { code: 'TM', name: 'Turkmenistan', dial: '993', flag: '🇹🇲' },
  { code: 'TC', name: 'Turks and Caicos Islands', dial: '1649', flag: '🇹🇨' },
  { code: 'TV', name: 'Tuvalu', dial: '688', flag: '🇹🇻' },
  { code: 'UG', name: 'Uganda', dial: '256', flag: '🇺🇬' },
  { code: 'UA', name: 'Ukraine', dial: '380', flag: '🇺🇦' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971', flag: '🇦🇪' },
  { code: 'GB', name: 'United Kingdom', dial: '44', flag: '🇬🇧' },
  { code: 'US', name: 'United States', dial: '1', flag: '🇺🇸' },
  { code: 'UY', name: 'Uruguay', dial: '598', flag: '🇺🇾' },
  { code: 'UZ', name: 'Uzbekistan', dial: '998', flag: '🇺🇿' },
  { code: 'VU', name: 'Vanuatu', dial: '678', flag: '🇻🇺' },
  { code: 'VA', name: 'Vatican City', dial: '379', flag: '🇻🇦' },
  { code: 'VE', name: 'Venezuela', dial: '58', flag: '🇻🇪' },
  { code: 'VN', name: 'Vietnam', dial: '84', flag: '🇻🇳' },
  { code: 'WF', name: 'Wallis and Futuna', dial: '681', flag: '🇼🇫' },
  { code: 'EH', name: 'Western Sahara', dial: '212', flag: '🇪🇭' },
  { code: 'YE', name: 'Yemen', dial: '967', flag: '🇾🇪' },
  { code: 'ZM', name: 'Zambia', dial: '260', flag: '🇿🇲' },
  { code: 'ZW', name: 'Zimbabwe', dial: '263', flag: '🇿🇼' },
];

/** Find a country by its ISO-3166 alpha-2 code (case-insensitive). */
export const findCountryByCode = (code?: string | null): Country | undefined => {
  if (!code) return undefined;
  const upper = code.toUpperCase();
  return COUNTRIES.find((c) => c.code === upper);
};

/** Find a country by exact (case-insensitive) name. */
export const findCountryByName = (name?: string | null): Country | undefined => {
  if (!name) return undefined;
  const lower = name.toLowerCase().trim();
  return COUNTRIES.find((c) => c.name.toLowerCase() === lower);
};

/**
 * Replace (or set) the dialing-code prefix on a phone number.
 * Strips any existing leading "+<digits>" prefix and prepends the new dial.
 * Returns "+<dial> <local>" — local part trimmed.
 */
export const applyDialCode = (rawPhone: string, dial: string): string => {
  const trimmed = (rawPhone || '').trim();
  // Remove any existing leading + and dialing code (digits up to first space or dash)
  const withoutPrefix = trimmed.replace(/^\+\d{1,4}[\s-]?/, '');
  if (!withoutPrefix) return `+${dial} `;
  return `+${dial} ${withoutPrefix}`.trim();
};

/** True if the phone string starts with a "+<digits>" dial-code prefix. */
export const hasDialCodePrefix = (phone: string | null | undefined): boolean => {
  if (!phone) return false;
  return /^\+\d{1,4}(\s|-|$)/.test(phone.trim());
};

/**
 * Guarantee a phone string keeps its dial-code prefix.
 * If the user wiped the prefix while editing the local part, restore it.
 */
export const enforceDialCodePrefix = (phone: string, dial: string): string => {
  const prefix = `+${dial}`;
  const trimmed = (phone || '').trimStart();
  if (!trimmed) return `${prefix} `;
  // Already starts with this exact prefix
  if (trimmed === prefix || trimmed.startsWith(`${prefix} `) || trimmed.startsWith(`${prefix}-`)) {
    return trimmed;
  }
  // Starts with a *different* dial code → swap it
  if (/^\+\d{1,4}/.test(trimmed)) {
    return applyDialCode(trimmed, dial);
  }
  // Local digits only → prepend
  return `${prefix} ${trimmed}`.trim();
};

/** Return only the local-number portion (everything after the "+<dial>" prefix). */
export const getLocalNumber = (phone: string | null | undefined): string => {
  if (!phone) return '';
  return phone.trim().replace(/^\+\d{1,4}[\s-]?/, '');
};

/**
 * Live phone formatter — call on every keystroke.
 *
 * Behavior:
 * • Always preserves "+<dial> " as a protected prefix (the user cannot delete it).
 * • Keeps a single space between the dial code and the local number.
 * • Strips characters that are not digits, spaces, or dashes from the local part.
 * • Collapses runs of whitespace inside the local number to a single space.
 */
export const formatPhoneAsTyping = (raw: string, dial: string): string => {
  const prefix = `+${dial}`;
  // Get whatever the user has after (or instead of) the prefix.
  let local = enforceDialCodePrefix(raw ?? '', dial)
    .slice(prefix.length)
    .replace(/^[\s-]+/, '');
  // Allow only digits, single spaces and dashes inside the local part.
  local = local
    .replace(/[^\d\s-]/g, '')
    .replace(/\s{2,}/g, ' ');
  return local ? `${prefix} ${local}` : `${prefix} `;
};

/**
 * Resolve a Country from a freeform "location" value stored on a profile.
 * Tries (in order):
 *   1. Exact ISO-3166 alpha-2 / alpha-3 code match.
 *   2. Exact case-insensitive country name match.
 *   3. The trailing token of a "City, Region, Country" string.
 *   4. Substring scan against the country list.
 *   5. Optional fallback: derive from a phone's "+<dial>" prefix.
 */
export const resolveCountryFromLocation = (
  location?: string | null,
  phone?: string | null,
): Country | undefined => {
  const value = (location ?? '').trim();
  if (value) {
    // 1) Direct code match (alpha-2 or alpha-3 — try alpha-2 only since list is alpha-2).
    if (value.length <= 3) {
      const byCode = findCountryByCode(value);
      if (byCode) return byCode;
    }
    // 2) Exact name.
    const byName = findCountryByName(value);
    if (byName) return byName;
    // 3) Trailing token after the last comma — handles "Nairobi, Kenya".
    if (value.includes(',')) {
      const tail = value.split(',').map((s) => s.trim()).filter(Boolean).pop();
      if (tail) {
        const t = findCountryByName(tail);
        if (t) return t;
      }
    }
    // 4) Substring scan — handles "Republic of Kenya", "United States of America".
    const lower = value.toLowerCase();
    const fuzzy = COUNTRIES.find(
      (c) => lower.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(lower),
    );
    if (fuzzy) return fuzzy;
  }
  // 5) Derive from phone dial prefix ("+254 …" → Kenya).
  if (phone) {
    const m = phone.trim().match(/^\+(\d{1,4})/);
    if (m) {
      const dial = m[1];
      // Prefer longest matching dial (e.g. 1876 over 1) for accuracy.
      const candidates = COUNTRIES.filter((c) => dial.startsWith(c.dial));
      if (candidates.length) {
        return candidates.sort((a, b) => b.dial.length - a.dial.length)[0];
      }
    }
  }
  return undefined;
};