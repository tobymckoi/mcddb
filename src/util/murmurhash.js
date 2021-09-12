"use strict";

/**
 * JS Implementation of MurmurHash2
 *
 * @author <a href="mailto:gary.court@gmail.com">Gary Court</a>
 * @see http://github.com/garycourt/murmurhash-js
 * @author <a href="mailto:aappleby@gmail.com">Austin Appleby</a>
 * @see http://sites.google.com/site/murmurhash/
 *
 * @param {Buffer} buf Buffer only
 * @param {number} seed Positive integer only
 * @return {number} 32-bit positive integer hash
 */


function getByteAt(buf, index) {
    return buf[index];
}


// Version 2
function murmurhash2_32_gc(buf, seed) {

    let l = buf.length;
    let h = seed ^ l;
    let i = 0;

    while (l >= 4) {

        let k = buf.readInt32LE(i);

        k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));
        k ^= k >>> 24;
        k = (((k & 0xffff) * 0x5bd1e995) + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16));

        h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^ k;

        l -= 4;
        i += 4;
    }

    switch (l) {
        case 3:
            h ^= (getByteAt(buf, i + 2) & 0xff) << 16;
            // fallsthrough
        case 2:
            h ^= (getByteAt(buf, i + 1) & 0xff) << 8;
            // fallsthrough
        case 1:
            h ^= (getByteAt(buf, i) & 0xff);
            h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
            // fallsthrough
        default:
    }

    h ^= h >>> 13;
    h = (((h & 0xffff) * 0x5bd1e995) + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16));
    h ^= h >>> 15;

    return h >>> 0;

}


// Version 3
function murmurhash3_32_gc(buf, seed) {

    let k1;

    const remainder = buf.length & 3; // key.length % 4
    const bytes = buf.length - remainder;
    let h1 = seed;
    const c1 = 0xcc9e2d51;
    const c2 = 0x1b873593;
    let i = 0;

    while (i < bytes) {

        let k1 = buf.readInt32LE(i);
        i += 4;

        k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;

        h1 ^= k1;
        h1 = (h1 << 13) | (h1 >>> 19);
        const h1b = ((((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16))) & 0xffffffff;
        h1 = (((h1b & 0xffff) + 0x6b64) + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16));

    }

    k1 = 0;

    switch (remainder) {
        case 3:
            k1 ^= (getByteAt(buf, i + 2) & 0xff) << 16;
            // fallsthrough
        case 2:
            k1 ^= (getByteAt(buf, i + 1) & 0xff) << 8;
            // fallsthrough
        case 1:
            k1 ^= (getByteAt(buf, i) & 0xff);
            // fallsthrough
        default:
            // fallsthrough

        k1 = (((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
        k1 = (k1 << 15) | (k1 >>> 17);
        k1 = (((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
        h1 ^= k1;
    }

    h1 ^= buf.length;

    h1 ^= h1 >>> 16;
    h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
    h1 ^= h1 >>> 13;
    h1 = ((((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16))) & 0xffffffff;
    h1 ^= h1 >>> 16;

    return h1 >>> 0;

}


module.exports = murmurhash3_32_gc;
