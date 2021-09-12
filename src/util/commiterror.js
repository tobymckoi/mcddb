"use strict";

function CommitError(msg) {
    const err = Error(msg);
    return err;
}

module.exports = CommitError;
