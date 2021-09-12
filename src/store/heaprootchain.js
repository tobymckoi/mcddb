"use strict";

const CommitError = require('../util/commiterror.js');

// A root chain is a sequence of in-store addresses (Addr) that reference
// the root nodes of a tree data structure that is modified over time. The root
// chain associates a timestamp with each root address, however, note that the
// sequence might not store timestamp/addr by a guarenteed incremental
// timestamp progression. Think of the log as first in / first out, the
// timestamp being a best attempt indicator of when the root node was added to
// the log.

function HeapRootChain() {

    // The root chain on the heap,
    const heap_root_chain = [];



    function atomicPutEntry(addr, supersede_addr) {
        const len = heap_root_chain.length;
        if (len > 0) {
            // Assert last entry is supersede_addr,
            const cur_top = heap_root_chain[heap_root_chain.length - 1];
            if ( cur_top.addr.neq( supersede_addr ) ) {
                throw CommitError(
                    "supersede_addr does not match expected (concurrent write to root chain)"
                );
            }
        }
        const timestamp = Date.now();
        heap_root_chain.push({ addr, timestamp });
    }

    function atomicGetLastEntry() {
        const len = heap_root_chain.length;
        if (len > 0) {
            const cur_top = heap_root_chain[heap_root_chain.length - 1];
            // Copy into new object,
            return {
                addr: cur_top.addr,
                timestamp: cur_top.timestamp
            };
        }
        return undefined;
    }



    // Puts an Addr entry into the root chain. 'supersede_addr' is the root
    // Addr that 'addr' must be superseded by. If 'supersede_addr' is not the
    // last entry in the chain, then the function fails. This allows for the
    // implementation of the most basic form of concurrency control (commit
    // fails on anything other than sequential updates to the data set).
    //
    // May return a Promise to perform this operation asynchronously.

    /* async */ function putEntry(addr, supersede_addr) {
        return /* await */ atomicPutEntry(addr, supersede_addr);
    }

    // Returns an object { addr, timestamp } representing the current root
    // node of this root chain, or a Promise to fetch is asynchrously.

    /* async */ function getLastEntry() {
        return /* await */ atomicGetLastEntry();
    }





    return {

        // Atomic operation that puts an entry into the root chain. This may
        // not work for all implementations. For example, a client may not be
        // able to put an entry into the root chain if it's required to be
        // validated via a consensus function.
        putEntry,

        // Get last root chain entry that was put into the chain, or undefined
        // if there is no last entry.
        getLastEntry,

    };

}

module.exports = HeapRootChain;
