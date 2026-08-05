/** CJS fixture: dynamic import wraps this in `default`, like lodash. */
module.exports = {
  shout: (s) => String(s).toUpperCase() + "!",
  initials: (s) => String(s).split(/\s+/).map((w) => w[0] ?? "").join(""),
};
