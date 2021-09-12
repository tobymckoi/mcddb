"use strict";

const Statics = require('./statics.js');
const { Addr } = require('./addr.js');

// A wrapper around a mutable in-memory Buffer, with a size and limit. A
// DataBuffer holds a special type of Addr that is unique only within the
// current environment. The interface of DataBuffer is similar to DataSpan
// and is intended to be interchangeable.
//
// DataBuffer can be freely mutabled, however data can only be written between
// 0 and limit.
//
// DataBuffer keeps track of addresses (Addr) written via the 'writeAddr'
// function. This allows tracking and inline modification of addresses
// embedded within the data.

const OUT_OF_BOUNDS_MSG = "Out of Bounds";
const OVERLAP_ADDR_MSG = "Update would cause Addr overwrite";


function DataBuffer(addr, buf, size, limit, dataspan_addr, PROTECTED_ACCESS) {

    const original_size = size;
    // Assume modifications are append only
    let append_only_modify = true;
    let is_modified = false;

    const addr_points = [];



    function checkIsBuffer(buf_to_check) {
        if ( Buffer.isBuffer(buf_to_check) !== true ) {
            throw Error("Expecting Buffer");
        }
    }


    // Throw error if the write is out of the limits of the current data buffer,
    function checkCanWrite(offset, write_size) {
        if (offset < 0 || offset + write_size > limit) {
            throw Error(OUT_OF_BOUNDS_MSG);
        }
        // Flag modification,
        is_modified = true;
        // If we know the original DataSpan hasn't yet been modified,
        if (append_only_modify) {
            // Check if original data span is modified by this write operation.
            // If it is, flag 'append_only_modify' to false,
            append_only_modify = ( offset >= original_size );
        }
        // Extend the size of buffer if necessary,
        size = Math.max(size, offset + write_size);
    }


    // Mark an address point at the given offset,
    function markAddrPoint(offset) {

        // Check existing address points in this data buffer,
        for (let i = 0; i < addr_points.length; ++i) {

            const ioffset = addr_points[i];

            // Address point already marked, so don't need to add again,
            if (offset === ioffset) {
                return;
            }

            // Assert we aren't overwriting an address that's previously
            // written,
            if ( ( offset > ioffset && offset < ioffset + 16 ) ||
                 ( offset + 16 > ioffset && offset + 16 < ioffset + 16 ) ) {
                throw Error(OVERLAP_ADDR_MSG);
            }

        }

        // Add address point in the data,
        addr_points.push(offset);

    }



    function writeBigInt(val, offset) {
        checkCanWrite(offset, 8);
        return buf.writeBigInt64BE(val, offset);
    }

    function writeBigUInt(val, offset) {
        checkCanWrite(offset, 8);
        return buf.writeBigUInt64BE(val, offset);
    }

    function writeDouble(val, offset) {
        checkCanWrite(offset, 8);
        return buf.writeDoubleBE(val, offset);
    }

    function writeFloat(val, offset) {
        checkCanWrite(offset, 4);
        return buf.writeFloatBE(val, offset);
    }

    function writeInt32(val, offset) {
        checkCanWrite(offset, 4);
        return buf.writeInt32BE(val, offset);
    }

    function writeInt16(val, offset) {
        checkCanWrite(offset, 2);
        return buf.writeInt16BE(val, offset);
    }

    function writeInt8(val, offset) {
        checkCanWrite(offset, 1);
        return buf.writeInt8(val, offset);
    }

    function writeUInt32(val, offset) {
        checkCanWrite(offset, 4);
        return buf.writeUInt32BE(val, offset);
    }

    function writeUInt16(val, offset) {
        checkCanWrite(offset, 2);
        return buf.writeUInt16BE(val, offset);
    }

    function writeUInt8(val, offset) {
        checkCanWrite(offset, 1);
        return buf.writeUInt8(val, offset);
    }

    // Writes an Addr buffer at the given offset.
    function writeAddr(val, offset) {
        const noffset = writeValue128(val, offset);
        markAddrPoint(offset);
        return noffset;
    }

    function writeValue128(val, offset) {
        checkCanWrite(offset, 16);
        val.copyTo(buf, offset);
        return offset + 16;
    }

    function copyFromBuffer(in_buf, offset, size, position) {
        checkIsBuffer(in_buf);
        checkCanWrite(position, size);
        in_buf.copy(buf, position, offset, offset + size);
    }

    function copyFromDataBuffer(in_databuf, offset, size, position) {
        checkCanWrite(position, size);

//        const transfer_buf = Buffer.alloc(size);
//        in_databuf.copyToBuffer(transfer_buf, 0, size, offset);
//        transfer_buf.copy(buf, position, 0, size);

        in_databuf.copyToBuffer(buf, position, size, offset);
        in_databuf.copyToAddrPoints(markAddrPoint, position, size, offset);

    }

    function copyToAddrPoints(doMarkAddrPoint, offset, size, position) {
        for (const ap_offset of addr_points) {
            if (ap_offset >= position && ap_offset < position + size) {
                doMarkAddrPoint((ap_offset - position) + offset);
            }
        }
    }

    // Shifts all data from offset to 'size' by the given amount of bytes,
    // either moving the data forwards if amount is positive, or backwards if
    // amount is negative.
    //
    // Also moves address points around as necessary.
    function shift(amount, offset) {

        // Range checks,
        const dest_start = offset + amount;
        const dest_end = size + amount;
        if (offset < 0 || offset > size || dest_start < 0 || dest_end > limit) {
            throw Error(OUT_OF_BOUNDS_MSG);
        }
        if (amount === 0) {
            return;
        }
        is_modified = true;

        // Modify Addr points,
        // If removing data, check if an address point partially fills
        // the space,
        let addr_points_to_remove;
        if (amount < 0) {
            const remove_start = offset + amount;
            const remove_end = offset;
            for (let i = 0; i < addr_points.length; ++i) {
                const ioffset = addr_points[i];
                // Check if the address point is clipped by the area removed,
                if ( ( ioffset < remove_start && ioffset + 16 > remove_start ) ||
                     ( ioffset < remove_end && ioffset + 16 > remove_end ) ) {
                    // Raise error if it does,
                    throw Error(OVERLAP_ADDR_MSG);
                }
                // Is this point fully enclosed by the removed area,
                if (ioffset >= remove_start && ioffset + 16 <= remove_end) {
                    // Add to the list of addr points to remove,
                    if (addr_points_to_remove === undefined) {
                        addr_points_to_remove = [ i ];
                    }
                    else {
                        addr_points_to_remove.push(i);
                    }
                }
            }
        }
        // If expanding, check we aren't expanding in the middle of an Addr,
        else {
            for (let i = 0; i < addr_points.length; ++i) {
                const ioffset = addr_points[i];
                if ( offset > ioffset && offset < ioffset + 16 ) {
                    throw Error(OVERLAP_ADDR_MSG);
                }
            }
        }

        // Shift data in the buffer,
        buf.copy(buf, dest_start, offset, size);

        // Removes any addr points inside the removed area,
        if (addr_points_to_remove !== undefined) {
            for (let i = addr_points_to_remove.length - 1; i >= 0; --i) {
                const index_to_remove = addr_points_to_remove[i];
                addr_points.splice(index_to_remove, 1);
            }
        }

        // Update address points that were shifted in position,
        for (let i = 0; i < addr_points.length; ++i) {
            const ioffset = addr_points[i];
            if (ioffset >= offset) {
                addr_points[i] = ioffset + amount;
            }
        }

        // If the size was reduced,
        if (amount < 0) {
            append_only_modify = false;
            // Fill the end space with zeros,
            buf.fill(0x0, size + amount, size);
        }
        // If the size was increased,
        else {
            if (offset < size) {
                append_only_modify = false;
            }
            // Fill the new space with zeros,
            buf.fill(0x0, offset, offset + amount);
        }

        // Change the size as a result of the shift,
        size += amount;

    }


    function setSize(new_size) {
        shift(new_size - size, size);
    }


    function checkProtectedAccess(security_value) {
        if (security_value !== PROTECTED_ACCESS) {
            throw Error("Protected function");
        }
    }




    function protectedSubstituteAddrMap(security_value, addrs_in, addrs_out) {
        checkProtectedAccess(security_value);
        for (const offset of addr_points) {
            // Address from the data,
            const addr = Addr( buf.slice(offset, offset + 16), true );
            // Search for substitution addrs_in -> addrs_out
            for (let i = 0; i < addrs_in.length; ++i) {
                if ( addr.isEqual( addrs_in[i] ) === true ) {
                    // Make substitution,
                    addrs_out[i].copyTo(buf, offset);
                    is_modified = true;
                }
            }
        }
    }

    function protectedValidateAddrs(security_value, isValidAddr) {
        checkProtectedAccess(security_value);
        for (const offset of addr_points) {
            // Address from the data,
            const addr = Addr( buf.slice(offset, offset + 16), true );
            if (!isValidAddr(addr)) {
                throw Error("Addr validation failed");
            }
        }
    }




    function protectedGetAddrOffsets(security_value) {
        checkProtectedAccess(security_value);
        return addr_points;
    }

    function protectedGetModificationInfo(security_value) {
        checkProtectedAccess(security_value);
        return {
            size,
            size_diff: size - original_size,
            dataspan_addr,
            append_only_modify
        };
    }




    // The address of the DataSpan this buffer was converted from. This is
    // used in the case we can append write to a block.
    function getDataSpanAddr() {
        return dataspan_addr;
    }

    function canAppendToDataSpan() {
        // If write operations only appended to end of originating DataSpan,
        return append_only_modify;
    }

    // True if this data buffer was modified after creation, or after being
    // converted from an existing DataSpan. Note; Returns true even if a
    // modification happened that resulted in exactly the same data.
    function isModified() {
        return is_modified;
    }


    function getAddr() {
        return addr;
    }

    function getLimit() {
        return limit;
    }

    function getSize() {
        return size;
    }


    function diag() {
        return '';
//        return JSON.stringify( addr_points );
    }



    const exported = {

        writeBigInt,
        writeBigUInt,
        writeDouble,
        writeFloat,
        writeInt32,
        writeInt16,
        writeInt8,
        writeUInt32,
        writeUInt16,
        writeUInt8,

        writeAddr,
        writeValue128,

        copyFromBuffer,
        copyFromDataBuffer,

        // Returns the DataSpan that we are modifying, or undefined if new
        // buffer,
        getDataSpanAddr,
        // True if the modifications made are such that we only need to append
        // to the original DataSpan,
        canAppendToDataSpan,

        // Shift data within the buffer,
        shift,

        // Sets the size of the buffer (can not exceed limit),
        setSize,

        copyToAddrPoints,

        // True if modifications have been made to this buffer since creation,
        isModified,

        getAddr,
        getLimit,
        getSize,

        protectedGetAddrOffsets,
        protectedGetModificationInfo,
        // Substitute embedded address,
        protectedSubstituteAddrMap,
        protectedValidateAddrs,

        diag,

    };
    return Object.assign(
            exported,
            Statics.generalBufferReader(buf, getSize, limit, false) );

}

module.exports = DataBuffer;
