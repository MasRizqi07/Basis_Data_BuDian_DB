function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requiredPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw httpError(400, `${label} harus berupa bilangan bulat positif.`);
  }
  return number;
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { asyncHandler, httpError, requiredPositiveInteger };
