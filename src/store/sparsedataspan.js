"use strict";


const { Addr } = require('./addr.js');
const Value128 = require('../util/value128.js');
const { BigInt64 } = require('../util/general.js');

const { MAX_SPARSE_SIZE_INTEGER } = require('./statics.js');

const ZERO_ADDR = Addr(0n, 0n);
const ZERO_VONETWENTYEIGHT = Value128(0n, 0n);


// A DataSpan that represents a sparse sequence of bytes (0). The size limit of
// a sparse node is MAX_SPARSE_SIZE_INTEGER.


function SparseDataSpan(addr) {

    // The size of the sparse data span,
    const bigint_size = addr.bigIntAt(8);

    if (bigint_size < 0 || bigint_size > MAX_SPARSE_SIZE_INTEGER) {
        throw Error("Sparse size out of bounds");
    }

    const size = Number(bigint_size);


    // Throw error if the read is out of the bounds of the current data span,
    function checkCanRead(offset, read_size) {
        if (offset < 0 || offset + read_size > getSize()) {
            throw Error("Read Out of Bounds");
        }
    }

    function readBigInt(offset) {
        checkCanRead(offset, 8);
        return BigInt64(0);
    }

    function readBigUInt(offset) {
        checkCanRead(offset, 8);
        return BigInt64(0);
    }

    function readDouble(offset) {
        checkCanRead(offset, 8);
        return 0;
    }

    function readFloat(offset) {
        checkCanRead(offset, 4);
        return 0;
    }

    function readInt32(offset) {
        checkCanRead(offset, 4);
        return 0;
    }

    function readInt16(offset) {
        checkCanRead(offset, 2);
        return 0;
    }

    function readInt8(offset) {
        checkCanRead(offset, 1);
        return 0;
    }

    function readUInt32(offset) {
        checkCanRead(offset, 4);
        return 0;
    }

    function readUInt16(offset) {
        checkCanRead(offset, 2);
        return 0;
    }

    function readUInt8(offset) {
        checkCanRead(offset, 1);
        return 0;
    }

    function readAddr(offset) {
        checkCanRead(offset, 16);
        return ZERO_ADDR;
    }

    function readValue128(offset) {
        checkCanRead(offset, 16);
        return ZERO_VONETWENTYEIGHT;
    }


    function copyToBuffer(out_buf, offset, size, position) {
        checkCanRead(position, size);
        out_buf.fill(0, offset, offset + size);
    }



    function asBuffer(nlimit) {
        // Allocate the new buffer,
        const nbuf = Buffer.allocUnsafeSlow(nlimit);
        // Fill with zeros
        nbuf.fill(0x0);
        // Return the buffer,
        return nbuf;
    }


    function asString() {
        return "<SPARSE: size = " + size + ">";
    }






    function getAddr() {
        return addr;
    }

    function getLimit() {
        return size;
    }

    function getSize() {
        return size;
    }



    return {

        getAddr,
        getLimit,
        getSize,

        readBigInt,
        readBigUInt,
        readDouble,
        readFloat,
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

    };

}

module.exports = SparseDataSpan;
