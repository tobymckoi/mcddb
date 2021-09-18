"use strict";

/* global BigInt */

function AsyncValue(fetchOperation) {

    const waiting = [];
    let value;

    // Perform the fetch operation,

    async function doFetch() {

        let waiting_copy;

        try {

            try {

                value = await fetchOperation();
                if (value === undefined) {
                    throw Error("fetch returned undefined value");
                }

            }
            finally {
                // Copy array and clear existing,
                waiting_copy = [...waiting];
                waiting.length = 0;
            }

            // Send out responses to any promises waiting,
            for (const p of waiting_copy) {
                p.resolve(value);
            }

        }
        catch (err) {

            // Send out rejections to any promises that are waiting,
            for (const p of waiting_copy) {
                p.reject(err);
            }

        }

    }


    // Either returns the value, or a Promise that resolves the value
    // asynchronously,
    function get() {

        // If value resolved already, return it now.
        if (value !== undefined) {
            return value;
        }

        // Otherwise return a promise to fetch it asynchronously,
        return new Promise( (resolve, reject) => {

            // If the value is fetched, return it immediately,
            if (value !== undefined) {
                return resolve(value);
            }
            // Otherwise push the promise callbacks to waiting set,
            waiting.push({ resolve, reject });
            // If this is the first waiting value,
            if (waiting.length === 1) {
                // Go perform the fetch asynchronously,
                doFetch();
            }

        } );

    }

    return {
        get
    };

}


// 64-bit precision BigInt,
function BigInt64(v) {
    return BigInt.asIntN( 64, BigInt( v ) );
}


// Given a string and a maximum byte size limit, calculates the offset into the
// string of the last codepoint that would fit into a buffer of that size if
// the string is encoded as UTF8. If a 'ZERO' terminator is encountered, then
// 'zero_terminated' is set to true in the returned object.
//
// Returns: {
//   i: Offset into the string of the codepoint.
//   bytesize: The byte size of str.substring(0, i) when encoded as utf8.
//   zero_terminated: True if the calculation terminated because of 0 codepoint.
// }

function calculateUTF8CodePointSize(str, max_codepoint_size) {
    const len = str.length;
    let calc_size = 0;
    for (let i = 0; i < len; ++i) {
        const last_size = calc_size;
        const last_i = i;
        const code = str.charCodeAt(i);
        if (code === 0x0) {
            // Zero terminator,
            return {
                i:last_i,
                bytesize:last_size,
                zero_terminated:true
            };
        }
        calc_size += 1;
        if (code > 0x007f && code <= 0x07ff) {
            calc_size += 1;
        }
        else if (code > 0x07ff && code <= 0xffff) {
            calc_size += 2;
        }
        if (code >= 0xD800 && code <= 0xDBFF) {
            calc_size += 1;
            i += 1;
        }
        if (calc_size > max_codepoint_size) {
            return {
                i:last_i,
                bytesize:last_size,
                zero_terminated:false
            };
        }
    }
    return {
        i:str.length,
        bytesize:calc_size,
        zero_terminated:false
    };
}


// Reads a UTF8 string up to the given maximum size of the string, or until
// a zero terminator character is found. Also stops converting codepoints
// if an entire codepoint can not be consumed before the end of the buffer is
// reached.

function readUTF8StringFromBuffer(buf, offset, size, max_length) {

    const len = size;
    let out = '';
    let i = offset;
    let terminated = false;

    for ( i = offset; i < len && out.length < max_length; ++i ) {

        const b = buf.readUInt8(i);
        let b2, b3, b4;

        // Zero terminator found,
        if (b === 0x0) {
            terminated = true;
            break;
        }

        // Single byte codepoint,
        else if ( (b & 0x080) !== 0x080 ) {
            out += String.fromCodePoint(b);
        }
        // Double codepoint, ( 110xxxxx 10xxxxxx )
        else if ( (b & 0b11100000) === 0b11000000 ) {
            if (i + 1 >= len) {
                break;
            }
            b2 = buf.readUInt8(i + 1);
            out += String.fromCodePoint( ((b  & 0x1f) << 6 ) |
                                          (b2 & 0x3f) );
            i += 1;
        }
        // Triple codepoint, ( 1110xxxx 10xxxxxx 10xxxxxx )
        else if ( (b & 0b11110000) === 0b11100000 ) {
            if (i + 2 >= len) {
                break;
            }
            b2 = buf.readUInt8(i + 1);
            b3 = buf.readUInt8(i + 2);
            out += String.fromCodePoint( ((b  & 0x0f) << 12 ) |
                                         ((b2 & 0x3f) << 6  ) |
                                          (b3 & 0x3f) );
            i += 2;
        }
        // Quad codepoint, ( 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx )
        else if ( (b & 0b11111000) === 0b11110000 ) {
            if (i + 3 >= len) {
                break;
            }
            b2 = buf.readUInt8(i + 1);
            b3 = buf.readUInt8(i + 2);
            b4 = buf.readUInt8(i + 3);
            out += String.fromCodePoint( ((b  & 0x07) << 18 ) |
                                         ((b2 & 0x3f) << 12 ) |
                                         ((b3 & 0x3f) << 6  ) |
                                          (b4 & 0x3f) );
            i += 3;
        }

    }

    return {
        str_part: out,
        bytesize: i - offset,
        zero_terminated: terminated
    };

}




module.exports = {
    AsyncValue,
    BigInt64,
    calculateUTF8CodePointSize,
    readUTF8StringFromBuffer
};
