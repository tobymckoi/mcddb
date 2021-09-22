"use strict";

const Int64 = require('./int64.js');

const hashCalculation = require('./murmurhash.js');

// An immutable 128-bit value used to reference data within the tree, both as
// the key and as reference to an address space.
// Internally represented as a 16 length byte buffer.

// Key construction can either be by string, Buffer or 2 Int64 values.
//
// Examples,
//   const key_1 = Key('ef00000000000000ae000000000040ae');
//   const key_2 = Key( Buffer.alloc(16).fill(0x020) );
//   const key_3 = Key(
//              Int64.fromString( '0f04220321000000', true, 16),
//              Int64.fromNumber( 0x040ae ) );



const HASH_SEED = 0x09ae88f;


// Returns a 16 byte length Buffer given either a hex string value
// representing the key, or from a buffer itself (preferrably a 16 byte
// slice of a larger buffer).

function valueToByteBuffer(val, val2) {

    if (val === undefined) {
        throw Error("Undefined value");
    }
    if (Buffer.isBuffer(val)) {
        if (val2 === true) {
            // Unsafe (assume underlying is immutable)
            return val;
        }
        else {
            // Safe (assume underlying is mutable)
            return immutableCopy( val, val.length );
        }
    }
    // Handle Int64 type,
    else if (Int64.isInt64(val)) {
        const buf = Buffer.allocUnsafeSlow(16);
        buf.writeUInt32BE( val.getHighBitsUnsigned(), 0 );
        buf.writeUInt32BE( val.getLowBitsUnsigned(), 4 );
        buf.writeUInt32BE( val2.getHighBitsUnsigned(), 8 );
        buf.writeUInt32BE( val2.getLowBitsUnsigned(), 12 );
        return buf;
    }
    // Is it a string? If so assume a hex encoded string,
    const valtype = typeof val;
    if (valtype === 'string') {
        return ensureBufferSize( Buffer.from(val, 'hex') );
    }
    // // Handle bigint type
    // else if (valtype === 'bigint') {
    //     const buf = Buffer.alloc(16);
    //     buf.writeBigInt64BE(val, 0);
    //     buf.writeBigInt64BE(val2, 8);
    //     return buf;
    // }
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
    const nbuf = Buffer.allocUnsafeSlow(16);
    buf.copy(nbuf, Math.max(0, 16 - buf_len), 0, Math.min(16, buf_len));
    return nbuf;
}



const inspect = Symbol.for('nodejs.util.inspect.custom');



// Value128 Class that uses private field to ensure the buffer is secure and
// immutable.

class Value128 {

    constructor(val, val2) {
         this._value_buffer = valueToByteBuffer(val, val2);
    }

    copyTo(buf, offset) {
        return this._value_buffer.copy(buf, offset, 0, 16);
    }

    asString() {
        return this._value_buffer.toString('hex');
    }

    [inspect]() {
        return `< ${this.asString()} >`;
    }

    asBuffer() {
        return immutableCopy(this._value_buffer, 16);
    }

    byteAt(offset) {
        if (offset >= 0 && offset < 16) {
            return this._value_buffer.readUInt8(offset);
        }
        throw Error("Out of range");
    }

    bigIntAt(offset) {
        if (offset >= 0 && offset <= 8) {
            return this._value_buffer.readBigInt64BE(offset);
        }
        throw Error("Out of range");
    }

    eq(n) {
        return this._value_buffer.equals(n._value_buffer);
    }
    neq(n) {
        return !this._value_buffer.equals(n._value_buffer);
    }
    gt(n) {
        return this.compareTo(n) > 0;
    }
    gte(n) {
        return this.compareTo(n) >= 0;
    }
    lt(n) {
        return this.compareTo(n) < 0;
    }
    lte(n) {
        return this.compareTo(n) <= 0;
    }

    isEqual(n) {
        return this.eq(n);
    }

    compareTo(n) {
        return this._value_buffer.compare(n._value_buffer);
    }

    isBufferEqual(buf) {
        return this._value_buffer.equals(buf);
    }

    compareBufferTo(buf) {
        return this._value_buffer.compare(buf);
    }

    hashCode() {
        return hashCalculation(this._value_buffer, HASH_SEED);
    }

}



// // Value128 Class that uses private field to ensure the buffer is secure and
// // immutable.
//
// class Value128 {
//
//     // Private field,
//     #value_buffer;
//
//     constructor(val, val2) {
//          this.#value_buffer = valueToByteBuffer(val, val2);
//     }
//
//     copyTo(buf, offset) {
//         return this.#value_buffer.copy(buf, offset, 0, 16);
//     }
//
//     asString() {
//         return this.#value_buffer.toString('hex');
//     }
//
//     [inspect]() {
//         return `< ${this.asString()} >`;
//     }
//
//     asBuffer() {
//         return immutableCopy(this.#value_buffer, 16);
//     }
//
//     byteAt(offset) {
//         if (offset >= 0 && offset < 16) {
//             return this.#value_buffer.readUInt8(offset);
//         }
//         throw Error("Out of range");
//     }
//
//     bigIntAt(offset) {
//         if (offset >= 0 && offset <= 8) {
//             return this.#value_buffer.readBigInt64BE(offset);
//         }
//         throw Error("Out of range");
//     }
//
//     eq(n) {
//         return this.isEqual(n) === true;
//     }
//     neq(n) {
//         return this.isEqual(n) === false;
//     }
//     gt(n) {
//         return this.compareTo(n) > 0;
//     }
//     gte(n) {
//         return this.compareTo(n) >= 0;
//     }
//     lt(n) {
//         return this.compareTo(n) < 0;
//     }
//     lte(n) {
//         return this.compareTo(n) <= 0;
//     }
//
//     isEqual(n) {
//         return this.#value_buffer.equals(n.#value_buffer);
//     }
//
//     compareTo(n) {
//         return this.#value_buffer.compare(n.#value_buffer);
//     }
//
//     isBufferEqual(buf) {
//         return this.#value_buffer.equals(buf);
//     }
//
//     compareBufferTo(buf) {
//         return this.#value_buffer.compare(buf);
//     }
//
//     hashCode() {
//         return hashCalculation(this.#value_buffer, HASH_SEED);
//     }
//
// }


function value128Create(val, val2) {
    return new Value128(val, val2);
}


// Export class create function,

module.exports = value128Create;
