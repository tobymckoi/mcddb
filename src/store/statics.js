"use strict";

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


// function generalBufferWriter(buf, size, limit) {
//
//     // Throw error if the read is out of the bounds of the current data span,
//     function checkCanWrite(offset, write_size) {
//         if (offset < 0 || offset + write_size > limit) {
//             throw Error("Write Out of Bounds");
//         }
//         // Update size of buffer,
//         size = Math.max(size, offset + write_size);
//     }
//
//     function writeBigInt(val, offset) {
//         checkCanWrite(offset, 8);
//         return buf.writeBigInt64BE(val, offset);
//     }
//
//     function writeBigUInt(val, offset) {
//         checkCanWrite(offset, 8);
//         return buf.writeBigUInt64BE(val, offset);
//     }
//
//     function writeDouble(val, offset) {
//         checkCanWrite(offset, 8);
//         return buf.writeDoubleBE(val, offset);
//     }
//
//     function writeFloat(val, offset) {
//         checkCanWrite(offset, 4);
//         return buf.writeFloatBE(val, offset);
//     }
//
//     function writeInt32(val, offset) {
//         checkCanWrite(offset, 4);
//         return buf.writeInt32BE(val, offset);
//     }
//
//     function writeInt16(val, offset) {
//         checkCanWrite(offset, 2);
//         return buf.writeInt16BE(val, offset);
//     }
//
//     function writeInt8(val, offset) {
//         checkCanWrite(offset, 1);
//         return buf.writeInt8(val, offset);
//     }
//
//     function writeUInt32(val, offset) {
//         checkCanWrite(offset, 4);
//         return buf.writeUInt32BE(val, offset);
//     }
//
//     function writeUInt16(val, offset) {
//         checkCanWrite(offset, 2);
//         return buf.writeUInt16BE(val, offset);
//     }
//
//     function writeUInt8(val, offset) {
//         checkCanWrite(offset, 1);
//         return buf.writeUInt8(val, offset);
//     }
//
//     return {
//
//         writeBigInt,
//         writeBigUInt,
//         writeDouble,
//         writeFloat,
//         writeInt32,
//         writeInt16,
//         writeInt8,
//         writeUInt32,
//         writeUInt16,
//         writeUInt8,
//
//     };
//
// }


const MAX_SPARSE_SIZE_INTEGER = Math.pow(2, 50);


module.exports = {
    generalBufferReader,
//    generalBufferWriter

    MAX_SPARSE_SIZE_INTEGER

};
