"use strict";

const Int64 = require('../util/int64.js');

const { Addr } = require('./addr.js');
const Value128 = require('../util/value128.js');

function generalBufferReader(buf, getSize, limit, immutable) {

    // Throw error if the read is out of the bounds of the current data span,
    function checkCanRead(offset, read_size) {
        if (offset < 0 || offset + read_size > getSize()) {
            throw Error("Read Out of Bounds");
        }
    }

    function readBigInt(offset) {
        checkCanRead(offset, 8);
        return buf.readBigInt64BE(offset);
    }

    function readBigUInt(offset) {
        checkCanRead(offset, 8);
        return buf.readBigUInt64BE(offset);
    }

    function readDouble(offset) {
        checkCanRead(offset, 8);
        return buf.readDoubleBE(offset);
    }

    function readFloat(offset) {
        checkCanRead(offset, 4);
        return buf.readFloatBE(offset);
    }

    function readInt64(offset) {
        checkCanRead(offset, 8);
        const vhigh = buf.readUInt32BE(offset + 0);
        const vlow = buf.readUInt32BE(offset + 4);
        return Int64.fromHighLowUInt(vhigh, vlow);
    }

    function readInt32(offset) {
        checkCanRead(offset, 4);
        return buf.readInt32BE(offset);
    }

    function readInt16(offset) {
        checkCanRead(offset, 2);
        return buf.readInt16BE(offset);
    }

    function readInt8(offset) {
        checkCanRead(offset, 1);
        return buf.readInt8(offset);
    }

    function readUInt32(offset) {
        checkCanRead(offset, 4);
        return buf.readUInt32BE(offset);
    }

    function readUInt16(offset) {
        checkCanRead(offset, 2);
        return buf.readUInt16BE(offset);
    }

    function readUInt8(offset) {
        checkCanRead(offset, 1);
        return buf.readUInt8(offset);
    }

    function readAddr(offset) {
        checkCanRead(offset, 16);
        return Addr( buf.slice(offset, offset + 16), immutable );
    }

    function readValue128(offset) {
        checkCanRead(offset, 16);
        return Value128( buf.slice(offset, offset + 16), immutable );
    }


    function copyToBuffer(out_buf, offset, size, position) {
        checkCanRead(position, size);
        buf.copy(out_buf, offset, position, position + size);
    }



    function asBuffer(nlimit) {
        // Allocate the new buffer,
        const nbuf = Buffer.allocUnsafeSlow(nlimit);
        // Fill with zeros
        nbuf.fill(0x0);
        // Copy current buffer to the new buffer,
        buf.copy(nbuf, 0, 0, getSize());
        // Return new buffer,
        return nbuf;
    }


    function asString() {
        return buf.toString('hex', 0, getSize());
    }


    // // Copies the current buffer to the target buffer,
    // function copyTo(target_buf) {
    //     return buf.copy(target_buf, 0, 0, getSize());
    // }

    return {

        readBigInt,
        readBigUInt,
        readDouble,
        readFloat,
        readInt64,
        readInt32,
        readInt16,
        readInt8,
        readUInt32,
        readUInt16,
        readUInt8,

        readAddr,
        readValue128,

        copyToBuffer,

        asBuffer,

        asString,

        // copyTo,

    };

}



const MAX_SPARSE_SIZE_INTEGER = Math.pow(2, 50);


module.exports = {
    generalBufferReader,
//    generalBufferWriter

    MAX_SPARSE_SIZE_INTEGER

};
