"use strict";

const Statics = require('./statics.js');

// Encapsulates a span of data. A data span is an addressable area of data
// that represents some part of data in the database. It can be initialised with
// a string of data, and modifications are limited to appends only. A DataSpan
// has a maximum size limit.
//
// A DataSpan should not be much larger than around 8KB.
//
// Generally data at this abstraction is not modified much. For example, if it
// represents a node in a tree, if a change is needed to be made to the node
// then the current DataSpan is discarded and a new one created with the
// modified data and different addr, and the updated node Addr is linked into
// the tree.
//
// However, a DataSpan may be modified in a very limited way without discarding
// the Addr. A DataSpan can be appended to at its 'size' offset provided the
// appended data doesn't extend past the limit.
//
// Note that a DataSpan can only be read here. Permenantly appending data to
// the span happens in the store.

function DataSpan(addr, buf, size, limit) {



    function getAddr() {
        return addr;
    }

    function getLimit() {
        return limit;
    }

    function getSize() {
        return size;
    }


    const exported = {

        getAddr,
        getLimit,
        getSize,

    };
    return Object.assign(
            exported,
            Statics.generalBufferReader(buf, getSize, limit, true) );

}

module.exports = DataSpan;
