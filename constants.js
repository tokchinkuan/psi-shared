// Phone country code to IANA timezone mapping
const PHONE_CODE_TO_TIMEZONE = {
  "+1": "America/New_York",
  "+7": "Europe/Moscow",
  "+20": "Africa/Cairo",
  "+27": "Africa/Johannesburg",
  "+30": "Europe/Athens",
  "+31": "Europe/Amsterdam",
  "+32": "Europe/Brussels",
  "+33": "Europe/Paris",
  "+34": "Europe/Madrid",
  "+36": "Europe/Budapest",
  "+39": "Europe/Rome",
  "+40": "Europe/Bucharest",
  "+41": "Europe/Zurich",
  "+43": "Europe/Vienna",
  "+44": "Europe/London",
  "+45": "Europe/Copenhagen",
  "+46": "Europe/Stockholm",
  "+47": "Europe/Oslo",
  "+48": "Europe/Warsaw",
  "+49": "Europe/Berlin",
  "+51": "America/Lima",
  "+52": "America/Mexico_City",
  "+54": "America/Argentina/Buenos_Aires",
  "+55": "America/Sao_Paulo",
  "+56": "America/Santiago",
  "+57": "America/Bogota",
  "+58": "America/Caracas",
  "+60": "Asia/Kuala_Lumpur",
  "+61": "Australia/Sydney",
  "+62": "Asia/Jakarta",
  "+63": "Asia/Manila",
  "+64": "Pacific/Auckland",
  "+65": "Asia/Singapore",
  "+66": "Asia/Bangkok",
  "+81": "Asia/Tokyo",
  "+82": "Asia/Seoul",
  "+84": "Asia/Ho_Chi_Minh",
  "+86": "Asia/Shanghai",
  "+90": "Europe/Istanbul",
  "+91": "Asia/Kolkata",
  "+92": "Asia/Karachi",
  "+98": "Asia/Tehran",
  "+212": "Africa/Casablanca",
  "+234": "Africa/Lagos",
  "+351": "Europe/Lisbon",
  "+353": "Europe/Dublin",
  "+358": "Europe/Helsinki",
  "+370": "Europe/Vilnius",
  "+371": "Europe/Riga",
  "+372": "Europe/Tallinn",
  "+380": "Europe/Kiev",
  "+381": "Europe/Belgrade",
  "+385": "Europe/Zagreb",
  "+386": "Europe/Ljubljana",
  "+420": "Europe/Prague",
  "+421": "Europe/Bratislava",
  "+506": "America/Costa_Rica",
  "+507": "America/Panama",
  "+591": "America/La_Paz",
  "+593": "America/Guayaquil",
  "+595": "America/Asuncion",
  "+598": "America/Montevideo",
  "+852": "Asia/Hong_Kong",
  "+855": "Asia/Phnom_Penh",
  "+880": "Asia/Dhaka",
  "+886": "Asia/Taipei",
  "+966": "Asia/Riyadh",
  "+971": "Asia/Dubai",
  "+972": "Asia/Jerusalem",
};

const USER_TIERS = {
  FREE: "free",
  PREMIUM: "premium",
  ADMIN: "admin",
  CHARTER: "charter",
};

const GAME_SCORE_NUMBERS = [0, 15, 30, 40, 50];

const ALLOWED_BET_CATEGORIES = [
  "2", // home/away
  "181", // correct score 1st set
  "182", // correct score 2nd set
  "22624", // over/under by games in match
  "22627", // over/under (1st set)
  "22691", // over/under by games (2nd set)
  "22628", // winner (1st set)
  "4", // asian handicap
  "22630", // asian handicap (sets)
  "22629", // asian handicap (1st set)
  "22698", // asian handicap (2nd set)
  "22631", // asian handicap (games)
  "22632", // set betting
  "22647", // set / match
  "22853-22854", // win at least one set
  "23258-23259", // win in straight sets
  "23262", // total tiebreaks
  "23620-23621", // win from behind
];

module.exports = {
  PHONE_CODE_TO_TIMEZONE,
  USER_TIERS,
  GAME_SCORE_NUMBERS,
  ALLOWED_BET_CATEGORIES,
};
