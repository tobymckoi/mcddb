"use strict";

const Addr = require('../util/value128.js');
const Int64 = require('../util/int64.js');

const INMEMORY_BRANCH_HIGH_64 = Int64.fromString('7000000000000000', true, 16);
const INMEMORY_LEAF_HIGH_64   = Int64.fromString('7100000000000000', true, 16);

const SPARSE_LEAF_HIGH_64     = Int64.fromString('63f0000000000000', true, 16);

// Address is an 128-bit buffer, exactly as Key,

function createInMemoryBranchAddr(subval_int64) {
    return Addr( INMEMORY_BRANCH_HIGH_64, subval_int64 );
}

function createInMemoryLeafAddr(subval_int64) {
    return Addr( INMEMORY_LEAF_HIGH_64, subval_int64 );
}

function isBranchNodeAddr(addr) {
    // Branch nodes always have '0' as second hex digit
    return (addr.byteAt(0) & 0x01) === 0x00;
}

function isLeafNodeAddr(addr) {
    // Leaf nodes always have '1' as second hex digit
    return (addr.byteAt(0) & 0x01) === 0x01;
}

function isInMemoryAddr(addr) {
    // Memory addresses always have '7' as first hex digit
    return (addr.byteAt(0) & 0x0f0) === 0x070;
}

function isStoreAddr(addr) {
    // Store addresses always have '6' as first hex digit
    return (addr.byteAt(0) & 0x0f0) === 0x060;
}

// Is a store address that can be converted to a local in-memory buffer. That
// means it's currently a store address and not a special addr.
function isConvertableStoreAddr(addr) {
    const sb = addr.byteAt(0);
    return ( (sb & 0x0f0) === 0x060 && (sb & 0x002) !== 0x002 );
}


function convertToStoreAddr(addr, subval_int, subval_int64) {

    const high_byte = (addr.byteAt(0) & 0x0f) | 0x060;

    let val = Int64.fromInt(high_byte);
    val = val.shiftLeft( 56 );
    val = val.or( subval_int | 0 );
    return Addr( val, subval_int64 );

}



// // Special case static Addr that represents an empty tree. That address can
// // only be at the root and is represented as a leaf node.
//
// const PROC_EMPTY_TREE_ADDR = Addr("63ff0000000000000000000000000000");


// Creates a special procedural leaf address representing a sparse leaf node
// of the given size. Represents a leaf node that contains a string of
// zero bytes of 'size_bigint' length.

function createSparseLeafAddr(size_int64) {
    // Store address (6), leaf node bit set and special code bit set.
    // 'f0' represents it being a sparse leaf node.
    return Addr( SPARSE_LEAF_HIGH_64, size_int64 );
}

function isSparseLeafAddr(addr) {
    return (addr.byteAt(0) === 0x063 && addr.byteAt(1) === 0x0f0);
}





module.exports = {

    Addr,

    createInMemoryBranchAddr,
    createInMemoryLeafAddr,
    isBranchNodeAddr,
    isLeafNodeAddr,
    isInMemoryAddr,
    isConvertableStoreAddr,
    isStoreAddr,
    convertToStoreAddr,

    createSparseLeafAddr,
    isSparseLeafAddr,

//    PROC_EMPTY_TREE_ADDR,

};
