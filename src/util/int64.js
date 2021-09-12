"use strict";

const Long = require('long');



const Int64 = Long;

function isInt64(val) {
    return Long.isLong(val);
}
Int64.isInt64 = isInt64;

// From 2 high/low unsigned integers,
function fromHighLowUInt(high, low) {
    return new Int64( low, high, true );
}
Int64.fromHighLowUInt = fromHighLowUInt;



module.exports = Int64;
