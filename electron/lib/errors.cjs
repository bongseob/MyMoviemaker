function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

module.exports = { getErrorMessage };
