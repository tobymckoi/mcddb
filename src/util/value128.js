"use strict";

const hashCalculation = require('./murmurhash.js');

// An immutable 128-bit value used to reference data within the tree, both as
// the key and as reference to an address space.
// Internally represented as a 16 length byte buffer.

// Key construction can either be by string, Buffer or 2 BigInt values.
//
// Examples,
//   const key_1 = Key('ef00000000000000ae000000000040ae');
//   const key_2 = Key( Buffer.alloc(16).fill(0x020) );
//   const key_3 = Key( 0x00f04220321000000n, 0x040aen );



const HASH_SEED = 0x09ae88f;


// Returns a 16 byte length Buffer given either a hex string value
// representing the key, or from a buffer itself (preferrably a 16 byte
// slice of a larger buffer).

function valueToByteBuffer(val, bigint_val2) {

    if (val === undefined) {
        throw Error("Undefined value");
    }
    if (Buffer.isBuffer(val)) {
        if (bigint_val2 === true) {
            // Unsafe (assume underlying is immutable)
            return val;
        }
        else {
            // Safe (assume underlying is mutable)
            return immutableCopy( val, val.length );
        }
    }
    // Is it a string? If so assume a hex encoded string,
    const valtype = typeof val;
    if (valtype === 'string') {
        return ensureBufferSize( Buffer.from(val, 'hex') );
    }
    // Handle bigint type
    else if (valtype === 'bigint') {
        const buf = Buffer.alloc(16);
        buf.writeBigInt64BE(val, 0);
        buf.writeBigInt64BE(bigint_val2, 8);
        return buf;
    }
    else {
        throw Error("Unknown type given");
    }

}

// Ensures the key size of the buffer is 16 bytes long exactly,

function ensureBufferSize(buf) {
    const buf_len = buf.length;
    if (buf_len === 16) {
        return buf;
    }
    return immutableCopy(buf, buf_len);
}

// Returns an immutable copy of the value buffer,

function immutableCopy(buf, buf_len) {
    const nbuf = Buffer.alloc(16);
    buf.copy(nbuf, Math.max(0, 16 - buf_len), 0, Math.min(16, buf_len));
    return nbuf;
}




// // If this is true, use a WeakMap to associate the buffer with each Value128
// //   export. If this is false, the immutable buffer can be exposed via the
// //   'isEqual' function.
//
// const USE_SECURE_VALUE128 = true;
//
// // Links exported object with its buffer in a way we can access the
// // data privately.
// let BUFFER_WMAP;
// if (USE_SECURE_VALUE128) {
//     BUFFER_WMAP = new WeakMap();
// }
//
// // Value128 class
//
// function Old_Value128(val, bigint_val2) {
//
//     const value_buffer = valueToByteBuffer(val, bigint_val2);
//
//     // Copies the value bytes (length 16) to a buffer at the given offset,
//     function copyTo(buf, offset) {
//         value_buffer.copy(buf, offset, 0, 16);
//     }
//
//     // Converts the value to a string.
//     function asString() {
//         return value_buffer.toString('hex');
//     }
//
//     // As a Buffer itself (a copy of the internal buffer to maintain
//     // immutability),
//     function asBuffer() {
//         const nbuf = Buffer.alloc(16);
//         value_buffer.copy(nbuf, 0, 0, 16);
//         return nbuf;
//     }
//
//     // True if this value is equal to the given value n
//     function isEqual(n) {
//         if (USE_SECURE_VALUE128) {
//             // Safe but uses WeakMap so possibly less memory efficient,
//             return isBufferEqual( BUFFER_WMAP.get(n) );
//         }
//         else {
//            // INSECURE: 'value_buffer' can get exposed to a user function here.
//            return n.isBufferEqual(value_buffer);
//         }
//     }
//
//     // Returns true if the buffer is equal to the given buffer,
//     function isBufferEqual(buf) {
//         return value_buffer.equals(buf);
//     }
//
//     // If this is greater than given Value128, returns 1. Returns 0 if equal.
//     // Returns -1 if this is less than given Value128.
//     function compareTo(n) {
//         if (USE_SECURE_VALUE128) {
//             // Safe but uses WeakMap so possibly less memory efficient,
//             return compareBufferTo( BUFFER_WMAP.get(n) );
//         }
//         else {
//            // INSECURE: 'value_buffer' can get exposed to a user function here.
//            return 0 - n.compareBufferTo(value_buffer);
//         }
//     }
//
//     // If this buffer is greater than given buffer, returns 1. Returns 0 if
//     // equal. Returns -1 if this is less than given buffer.
//     function compareBufferTo(buf) {
//         return value_buffer.compare(buf);
//     }
//
//
//
//     const exported = {
//
//         copyTo,
//
//         isEqual,
//         isBufferEqual,
//
//         compareTo,
//         compareBufferTo,
//
//         asString,
//         asBuffer,
//
//     };
//     if (USE_SECURE_VALUE128) {
//         // Reference 'value_buffer' to the exported object via a weak map,
//         BUFFER_WMAP.set(exported, value_buffer);
//     }
//     return exported;
//
// }


const inspect = Symbol.for('nodejs.util.inspect.custom');


// Value128 Class that uses private field to ensure the buffer is secure and
// immutable.

class Value128 {

    // Private field,
    #value_buffer;

    constructor(val, bigint_val2) {
         this.#value_buffer = valueToByteBuffer(val, bigint_val2);
    }

    copyTo(buf, offset) {
        return this.#value_buffer.copy(buf, offset, 0, 16);
    }

    asString() {
        return this.#value_buffer.toString('hex');
    }

    [inspect]() {
        return `< ${this.asString()} >`;
    }

    asBuffer() {
        return immutableCopy(this.#value_buffer, 16);
    }

    byteAt(offset) {
        if (offset >= 0 && offset < 16) {
            return this.#value_buffer.readUInt8(offset);
        }
        throw Error("Out of range");
    }

    bigIntAt(offset) {
        if (offset >= 0 && offset <= 8) {
            return this.#value_buffer.readBigInt64BE(offset);
        }
        throw Error("Out of range");
    }

    isEqual(n) {
        return this.#value_buffer.equals(n.#value_buffer);
    }

    compareTo(n) {
        return this.#value_buffer.compare(n.#value_buffer);
    }

    isBufferEqual(buf) {
        return this.#value_buffer.equals(buf);
    }

    compareBufferTo(buf) {
        return this.#value_buffer.compare(buf);
    }

    hashCode() {
        return hashCalculation(this.#value_buffer, HASH_SEED);
    }

}


// Export class create function,

module.exports = (val, bigint_val2) => {
    return new Value128(val, bigint_val2);
};
