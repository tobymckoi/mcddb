"use strict";





// Generates an integer hash value for a 128 bit value object,

function v128HashFunction(v1) {
    return v1.hashCode();
}

// Equality test for 128 bit values,

function v128EqualsFunction(v1, v2) {
    return v1.isEqual(v2);
}


module.exports = {
    v128HashFunction,
    v128EqualsFunction
};
