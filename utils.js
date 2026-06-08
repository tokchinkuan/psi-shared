const { PHONE_CODE_TO_TIMEZONE } = require("./constants");

const arrayfy = (input) => {
  return Array.isArray(input) ? input : [input];
};

const splitIntoChunks = (array, chunkSize) => {
  const arrayChunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    arrayChunks.push(array.slice(i, i + chunkSize));
  }
  return arrayChunks;
};

// GoalServe date string "DD.MM.YYYY" + time "HH:MM:SS" → ISO 8601 UTC
const getUtcDateString = (date, time) => {
  const [day, month, year] = date.split(".");
  return `${year}-${month}-${day}T${time}Z`;
};

const getTimezoneFromPhone = (phoneNumber) => {
  if (!phoneNumber) return "UTC";
  const cleaned = phoneNumber.replace(/[\s\-()]/g, "");
  for (const len of [4, 3, 2]) {
    for (const [code, tz] of Object.entries(PHONE_CODE_TO_TIMEZONE)) {
      if (code.length === len && cleaned.startsWith(code)) return tz;
    }
  }
  return "UTC";
};

const getDateInTimezone = (date, timezone) => {
  return new Date(date).toLocaleDateString("en-CA", { timeZone: timezone });
};

const titlelize = (str) => {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

const getPsiCategory = (psiValue, psiType = "Overall") => {
  if (psiValue === null) return null;
  let psiCategory = null;
  if (psiType === "Serve") {
    if (psiValue <= -0.05) {
      psiCategory = "Poor Performance";
    } else if (psiValue > -0.05 && psiValue < 0.75) {
      psiCategory = "Below Average Performance";
    } else if (psiValue >= 0.75 && psiValue < 1.45) {
      psiCategory = "Solid Performance";
    } else if (psiValue >= 1.45 && psiValue < 2.05) {
      psiCategory = "Above Average Performance";
    } else {
      psiCategory = "Excellent Performance";
    }
  } else if (psiType === "Return of Serve") {
    if (psiValue <= -2.65) {
      psiCategory = "Poor Performance";
    } else if (psiValue > -2.65 && psiValue <= -2.05) {
      psiCategory = "Below Average Performance";
    } else if (psiValue > -2.05 && psiValue <= -1.45) {
      psiCategory = "Solid Performance";
    } else if (psiValue > -1.45 && psiValue <= -0.75) {
      psiCategory = "Above Average Performance";
    } else {
      psiCategory = "Excellent Performance";
    }
  } else if (psiType === "Groundstroke & Auxiliary") {
    if (psiValue <= -1.25) {
      psiCategory = "Poor Performance";
    } else if (psiValue > -1.25 && psiValue <= -0.55) {
      psiCategory = "Below Average Performance";
    } else if (psiValue > -0.55 && psiValue < 0.45) {
      psiCategory = "Solid Performance";
    } else if (psiValue >= 0.45 && psiValue < 1.15) {
      psiCategory = "Above Average Performance";
    } else {
      psiCategory = "Excellent Performance";
    }
  } else if (psiType === "Overall") {
    if (psiValue <= -1.25) {
      psiCategory = "Poor Performance";
    } else if (psiValue > -1.25 && psiValue <= -0.15) {
      psiCategory = "Below Average Performance";
    } else if (psiValue > -0.15 && psiValue < 1.15) {
      psiCategory = "Solid Performance";
    } else if (psiValue >= 1.15 && psiValue < 2.15) {
      psiCategory = "Above Average Performance";
    } else {
      psiCategory = "Excellent Performance";
    }
  }
  return psiCategory;
};

module.exports = {
  arrayfy,
  splitIntoChunks,
  getUtcDateString,
  getTimezoneFromPhone,
  getDateInTimezone,
  titlelize,
  getPsiCategory,
};
