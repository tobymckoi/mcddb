"use strict";

const Key = require('../util/value128.js');

const KeyStatics = {
    FAR_LEFT_KEY:  Key("00000000000000000000000000000000"),
    FAR_RIGHT_KEY: Key("ffffffffffffffffffffffffffffffff"),
};

module.exports = {
    Key,
    KeyStatics
};
