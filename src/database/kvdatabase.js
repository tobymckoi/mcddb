"use strict";

// The base key/value database object used as the root for all transactional
// access to data structures stored in mcddb.
//
// Constructor arguments:
//
//   store -> The Store object for address space access to in-memory and
//            in-store buffers.

const { Addr } = require('../store/addr.js');
const TreeStack = require('../tree/treestack.js');

const { AsyncValue } = require('../util/general.js');
const Int64 = require('../util/int64.js');

// // Symbol for protected access to functions here,
// const PROTECTED_ACCESS = Symbol('KVDatabase Protected');







function DataValue(key, performAsyncTreeStackOp) {

    // Relative position. Negative value is position relative to the end + 1.
    // Positive value is position relative to the start.
    let relative_position = Int64.NEG_ONE;

    function getKey() {
        return key;
    }

    // Set the position of the cursor over the data value,
    function setPosition(position) {
        // Assert Int64,
        if (Int64.isInt64( position ) !== true) {
            throw Error("Expecting Int64");
        }
        throw Error("PENDING");
    }

    // Returns the position (Int64 type) relative to the start of the data.
    // Note that this can be an expensive operation.
    function getPosition() {
        throw Error("PENDING");
    }

    function start() {
        relative_position = Int64.ZERO;
    }

    function end() {
        relative_position = Int64.NEG_ONE;
    }

    function getSize() {
        throw Error("PENDING");
    }



    // Common asynchronous function for loading the tree stack, locking the
    // stack, loading the stack to a key/position, and performing a possible
    // async operation on the loaded stack.

    function stackProgressOperation(processFunction) {

        return performAsyncTreeStackOp( async (tree_stack) => {

            // Position stack at relative position,
            await tree_stack.setupStackForRelativePosition( key, relative_position );

            // Perform the operation on the tree stack.
            const ret = await processFunction(tree_stack);

            // Refresh the relative position,
            relative_position = tree_stack.getRelativePosition();

            return ret;

        });

    }


    // Reads a byte value from this data value at the current position and
    // then increments the position pointer by 1.
    /* async */ function readUInt8() {
        return stackProgressOperation( (tree_stack) => {
            return tree_stack.readUInt8( );
        });
    }

    // Writes a byte value to the data value at the current position and then
    // increments the position pointer by 1.
    /* async */ function writeUInt8(v) {
        return stackProgressOperation( (tree_stack) => {
            return tree_stack.writeUInt8( v );
        });
    }


    // Reads data from the current point and turns it into a string until
    // either; a) A zero terminator byte is encountered, b) Number of
    // characters consumed reaches 'length', c) End of data is reached.
    /* async */ function readString(length, encoding) {
        return stackProgressOperation( (tree_stack) => {
            return tree_stack.readString( encoding );
        });
    }

    // Writes a string to the data value. Note that the string encoding may
    // write more bytes than the number of characters in the string. This does
    // NOT zero terminate the string, and will never write a ZERO character for
    // utf8 encoding.
    /* async */ function writeString(str, encoding) {
        return stackProgressOperation( (tree_stack) => {
            return tree_stack.writeString( str, encoding );
        });
    }



    // Reads the data value from the current position and writes out to the
    // given buffer,
    /* async */ function copyToBuffer(buf, offset, size) {
        return stackProgressOperation( (tree_stack) => {
            return tree_stack.copyToBuffer( buf, offset, size );
        });
    }

    // Reads data from the buffer and writes out to the data value at the
    // current position.
    /* async */ function copyFromBuffer(buf, offset, size) {
        return stackProgressOperation( (tree_stack) => {
            return tree_stack.copyFromBuffer( buf, offset, size );
        });
    }



    return {

        getKey,

        setPosition,     // async
        getPosition,     // async

        start,           // async
        end,             // async
        getSize,         // async

        readUInt8,       // async
        writeUInt8,      // async

        readString,      // async
        writeString,     // async

        copyToBuffer,    // async
        copyFromBuffer,  // async

        // readBigInt,
        // readBigUInt,
        // readDouble,
        // readFloat,
        // readInt32,
        // readInt16,
        // readInt8,
        // readUInt32,
        // readUInt16,
        // readUInt8,
        //
        // // Zero terminated utf8 string,
        // readUTF8,





    };

}








function TX(store, rootchain) {

    // // root Addr is fetched via async function,
    // const root_addr = AsyncValue(async () => {
    //     const last_entry = await rootchain.getLastEntry();
    //     if (last_entry === undefined) {
    //         throw Error("rootchain is not yet bootstapped");
    //     }
    //     return last_entry.addr;
    // });
    //
    // async function getRootAddr() {
    //     return await root_addr.get();
    // }

    // The tree stack for this transaction,
    const tree_stack = AsyncValue(async () => {

        // Get the last entry from the root chain,
        const last_entry = await rootchain.getLastEntry();
        // Error if 'undefined',
        if (last_entry === undefined) {
            throw Error("rootchain is not yet bootstapped");
        }

        // Get the Addr,
        const root_addr = last_entry.addr;
        // Return it wrapped by the root addr we just loaded,
        return TreeStack(store, root_addr);

    });

    // Returns the tree stack or a Promise,
    /* async */ function getTreeStack() {
        return /* await */ tree_stack.get();
    }


    // Async lock and execute,
    async function performAsyncTreeStackOp( callFunction ) {

        const tree_stack = await getTreeStack();
        await tree_stack.lock();

        try {

            // Note, we have to 'await' here because 'tree_stack.unlock()'
            // must happen after the call has completed,
            return await callFunction(tree_stack);

        }
        finally {
            await tree_stack.unlock();
        }

    }





    // Returns a DataValue, used for reading and writing
    function getDataValue(key) {
        return DataValue(key, performAsyncTreeStackOp);
    }

    // Commit any modifications made in this transaction,
    async function commit() {

        const tree_stack = await getTreeStack();

        // Lock the stack to ensure async mutation of the stack state is not
        // possible.
        await tree_stack.lock();

        try {

            const prev_root_addr = tree_stack.getOriginatingRootAddr();
            const new_root_addr = tree_stack.getRootAddr();

            const inmemory_addrs = tree_stack.getAllInMemoryAddresses();
            tree_stack.invalidate();

            if ( prev_root_addr.eq( new_root_addr ) ||
                 inmemory_addrs.length === 0 ) {
                // No changes to commit, so just return,
                return;
            }

            const data_buffs = store.getAllDataBuffers( inmemory_addrs );
            const out_addr_set = await store.writeAll(data_buffs);

            // console.log(inmemory_addrs);
            // console.log(out_addr_set);
            // console.log("prev_root = ", prev_root_addr);
            // console.log("new_root = ", new_root_addr);

            let new_root_store_addr;
            for (let i = 0; i < inmemory_addrs.length; ++i) {
                const mem_addr = inmemory_addrs[i];
                if ( mem_addr.eq( new_root_addr ) ) {
                    new_root_store_addr = out_addr_set[i];
                    break;
                }
            }

            if (new_root_store_addr === undefined) {
                throw Error("Unable to find stored addr map for root.");
            }

            // console.log("new_store_root = ", new_root_store_addr);

            await rootchain.putEntry( new_root_store_addr, prev_root_addr );

        }
        finally {
            await tree_stack.unlock();
        }

    }

    // Close this transaction and invalidates it (frees up resources)
    function close() {
        console.error("TX.close() implementation pending.");
    }




    function debugCheckTreeIntegrity() {
        return performAsyncTreeStackOp((tree_stack) => {
            return tree_stack.debugCheckTreeIntegrity();
        });
    }


    function debugDumpTreeBranches(println) {
        return performAsyncTreeStackOp((tree_stack) => {
            return tree_stack.debugDumpTreeBranches(println);
        });
    }


    function debugDumpStackState(println) {
        return performAsyncTreeStackOp((tree_stack) => {
            return tree_stack.debugDumpStackState(println);
        });
    }


    function debugRunCustomChecks(println) {
        return performAsyncTreeStackOp((tree_stack) => {
            return tree_stack.debugRunCustomChecks(println);
        });
    }




    return {

        getDataValue,

        commit,                   // async

        close,

        debugCheckTreeIntegrity,  // async
        debugDumpTreeBranches,
        debugDumpStackState,
        debugRunCustomChecks

    };

}





function KVDatabase(store, rootchain) {






    function tx() {
        return TX(store, rootchain);
    }

    return {

        // Create new transaction
        tx

    };

}

module.exports = KVDatabase;
