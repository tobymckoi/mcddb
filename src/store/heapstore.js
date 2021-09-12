"use strict";

const Value128Static = require('../util/value128_static.js');
const HashMap = require('../util/hashmap.js');
const SparseDataSpan = require('./sparsedataspan.js');
const DataSpan = require('./dataspan.js');
const DataBuffer = require('./databuffer.js');

const { createInMemoryBranchAddr,
        createInMemoryLeafAddr,
        isBranchNodeAddr,
        isStoreAddr,
        isConvertableStoreAddr,
        isLeafNodeAddr,
        isSparseLeafAddr,
        convertToStoreAddr,
      } = require('./addr.js');

// Simple heap store for retaining and accessing nodes on the heap.
// Only use this for testing.

const addrHashFunction = Value128Static.v128HashFunction;
const addrEqualsFunction = Value128Static.v128EqualsFunction;


const PROTECTED_ACCESS = Symbol('HeapStore Protected');


function HeapStore(DSPAN_LIMIT = 8192) {


    // BigInt identifier for stored addresses.
    let cur_stored_id = 0x0cc50n;

    // Create the HashMap,
    const store_hashmap = HashMap(addrHashFunction, addrEqualsFunction);




    // Allocates store addresses with hints about the data being stored.
    // The hints being:
    //  {
    //    dataspan_addr:
    //      [ the Addr of the DataSpan that originated the data, or undefined ]
    //    size:
    //      [ the current size of the stored data ]
    //    size_diff:
    //      [ the difference is size between this and the originating DataSpan ]
    //    append_only_modify:
    //      [ boolean that's true if new data was only ever appended to the
    //        end of the DataSpan ]
    //  }
    function allocateStoreAddr(addr_in_set, data_hints) {
//        console.log("HINTS ", data_hints);
        const count = data_hints.length;
        const out = [];
        for (let i = 0; i < count; ++i) {
            // Convert the inmemory addr to a store addr, preserving any
            // meta information such is if it's a branch, leaf or sparse,
            // etc
            const addr = convertToStoreAddr(addr_in_set[i], 0, cur_stored_id);
            cur_stored_id += 1n;
            out.push(addr);
        }
        return out;
    }


    // Writes all databuffers in the list out to the address space represented
    // by the set of 'addrs'

    function writeAllToStore(databuffers, addrs) {

        for (let i = 0; i < databuffers.length; ++i) {

            const databuffer = databuffers[i];
            const addr = addrs[i];

            const size = databuffer.getSize();
            const nbuf = databuffer.asBuffer(size);

            const dataspan = DataSpan(addr, nbuf, size, DSPAN_LIMIT);

            // Store in the map,
            store_hashmap.set(addr, dataspan);

        }

    }



    function promiseReadFromStore(addr) {
        return new Promise((resolve, reject) => {
            try {
                // Returns the buffer from the store,
                resolve( store_hashmap.get(addr) );
            }
            catch (err) {
                reject(err);
            }
        });
    }

    function nonePromiseReadFromStore(addr) {
        return store_hashmap.get(addr);
    }


    function readFromStore(addr) {

        // Fast call that works for memory heap store,
        return nonePromiseReadFromStore(addr);

        // // This is to ensure that all calls to 'get' always use 'await',
        // return promiseReadFromStore(addr);

    }


















    // BigInt identifier for in-memory addresses.
    let cur_inmemory_id = 0n;

    const in_memory_hashmap = HashMap(addrHashFunction, addrEqualsFunction);







    function nextInMemoryAddr(is_branch) {

        const addr = is_branch
            ? createInMemoryBranchAddr(cur_inmemory_id)
            : createInMemoryLeafAddr(cur_inmemory_id);

        cur_inmemory_id += 1n;

        return addr;

    }

    // // Writes a DataBuffer to the store, and returns an Addr object that can
    // // be used to reference the object globally.
    //
    // async function write(databuffer) {
    //
    //     // Create a new address object,
    //     const addr = await allocateStoreAddr(1)[0];
    //     // Write buffer,
    //     await writeToStore(databuffer, addr);
    //
    //     // Return the address to the store object,
    //     return addr;
    // }


    async function writeAll(databuffers) {

        // How we map memory addr to store addr,

        const addr_in_set = [];
        const data_hints = [];

        for (const databuffer of databuffers) {
            const inmemory_addr = databuffer.getAddr();
            const mod_hint =
                    databuffer.protectedGetModificationInfo(PROTECTED_ACCESS);
            addr_in_set.push(inmemory_addr);
            data_hints.push(mod_hint);
        }

        const addr_out_set = await allocateStoreAddr(addr_in_set, data_hints);

        // Substitute and validate all Addr in the buffers,
        for (let i = 0; i < databuffers.length; ++i) {

            const databuffer = databuffers[i];

            // Substitute addresses,
            databuffer.protectedSubstituteAddrMap(
                                PROTECTED_ACCESS, addr_in_set, addr_out_set);
            // Check updated addresses are all valid,
            databuffer.protectedValidateAddrs(
                                PROTECTED_ACCESS, isStoreAddr);

            // if (isBranchNodeAddr(databuffer.getAddr())) {
            //     console.log("CHECK BRANCH BEING WRITTEN:");
            //     console.log(databuffer.asString());
            // }

        }

        // Write out all the buffers,
        await writeAllToStore( databuffers, addr_out_set );

        // Remove in-memory buffers,
        for (const addr of addr_in_set) {
            in_memory_hashmap.remove(addr);
        }

        return addr_out_set;

    }




    // Gets a DataSpan from the store given an Addr object.
    //
    // Either returns the value if available in the cache, or a Promise to
    // fetch the value asynchronously.

    /* async */ function get(addr) {

        // Returns the buffer from the store if it's a store address,
        if (isStoreAddr(addr)) {
            if (isSparseLeafAddr(addr)) {
                return SparseDataSpan(addr);
            }
            else {
                return /* await */ readFromStore(addr);
            }
        }
        // Otherwise must be in-memory,
        else {
            const buf = in_memory_hashmap.get(addr);
            if (buf === undefined) {
                console.error(addr);
                throw Error("Unable to find address");
            }
            return buf;
        }

    }


    // Returns all in-memory DataBuffer objects given in the list. This is
    // not an asynchronous function.

    function getAllDataBuffers(addrs) {

        const out_arrs = [];
        for (const addr of addrs) {
            const buf = in_memory_hashmap.get( addr );
            if (buf === undefined) {
                throw Error("Unable to find address");
            }
            out_arrs.push( buf );
        }
        return out_arrs;

    }


    // Creates an empty DataBuffer object, which is a mutable buffer that can
    // be populated with data in-memory. Flags the address as either a branch
    // or leaf.

    function createEmptyDataBuffer(is_branch) {

        if (is_branch === undefined) {
            throw Error("Expecting node type ( is_branch = undefined )");
        }

        const addr = nextInMemoryAddr(is_branch);

        const size = 0;

        // Allocate the underlying buffer,
        const nbuf = Buffer.allocUnsafeSlow(DSPAN_LIMIT);
        // Fill with zeros
        nbuf.fill(0x0);

        // Wrap around a mutable data buffer,
        const databuffer =
                DataBuffer( addr, nbuf, size, DSPAN_LIMIT,
                            undefined, PROTECTED_ACCESS );

        // Store in the in-memory map,
        in_memory_hashmap.set(addr, databuffer);

        return databuffer;

    }


    // Converts a DataSpan to a DataBuffer object. Or in other words, makes
    // a mutable in-memory data buffer from an immutable one.

    function convertSpanToBuffer(dataspan) {

        if ( !canConvertToBuffer( dataspan.getAddr() ) ) {
            throw Error("Can not convert address to a buffer (It's already a buffer or special node)");
        }

        const addr = nextInMemoryAddr(
                                isBranchNodeAddr( dataspan.getAddr() ) );

        // Copy data span to a new buffer with given maximum size,
        const nbuf = dataspan.asBuffer(DSPAN_LIMIT);

        const databuffer =
                DataBuffer( addr, nbuf, dataspan.getSize(), DSPAN_LIMIT,
                            dataspan.getAddr(), PROTECTED_ACCESS );

        // Store in the in-memory map,
        in_memory_hashmap.set(addr, databuffer);

        return databuffer;

    }


    function canConvertToBuffer(addr) {
        return isConvertableStoreAddr(addr);
    }

    function getNodeDataByteSizeLimit() {
        return DSPAN_LIMIT;
    }



    // Updates the content of a buffer.

    return {

        // Writes all DataBuffer objects to the store, and also rewrites all
        // temporary in-memory Addr embedded in the data to permanent Addr
        // references.
        //
        // Returns a set of Addr objects that can be used to reference the
        // data via 'get' and 'getAll'.

        writeAll,   // async

        // Gets a DataSpan from the store given an Addr object. The address
        // must be in global space.
        //
        //     async get(Addr): Buffer

        get,        // async

        // Gets all DataBuffer from the given array of Addr.

        getAllDataBuffers,

        // Creates an empty (size 0) DataBuffer with an address in local space.

        createEmptyDataBuffer,

        // Converts an immutable DataSpan object to a mutable DataBuffer object.
        // The address of the new DataBuffer will be in a local address space.

        convertSpanToBuffer,

        // Returns true if the given address is a span, and can be converted
        // to a buffer.
        canConvertToBuffer,

        // Returns the maximum size of a material (as represented by Buffer)
        // data node. This limit does not apply to none-material nodes such
        // as sparse leaf nodes.
        getNodeDataByteSizeLimit,


    };

}

module.exports = HeapStore;
