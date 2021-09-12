"use strict";

const { KeyStatics } = require('./key.js');

const { BigInt64 } = require('../util/general.js');

const { isBranchNodeAddr,
        isStoreAddr,
        PROC_EMPTY_TREE_ADDR
      } = require('../store/addr.js');

// Get KeyStatics for far left and right key,
const { FAR_LEFT_KEY, FAR_RIGHT_KEY } = KeyStatics;

// Maximum children per branch,
const MAX_BRANCH_CHILDREN = 19;    // 80
const MIN_BRANCH_CHILDREN = 7;     // 35

const LEAF = false;
const BRANCH = true;

const DEFAULT_STRING_ENCODING = 'utf8';




function StackState() {

    const stack = [];

    function createStackElement(addr_offset, down_addr, down_size, left_offset, left_key, right_key) {
        return {
            addr_offset, down_addr, down_size, left_offset,
            left_key, right_key
        };
    }

    function pushToStack(stack_level, addr_offset, down_addr, down_size, left_offset, left_key, right_key) {
        stack[stack_level] = createStackElement(
                addr_offset, down_addr, down_size, left_offset,
                left_key, right_key );
    }

    function getEntry(i) {
        return stack[ i ];
    }

    function lastStackEntry() {
        return getEntry( getSize() - 1 );
    }

    function clear() {
        clearEntriesAfter(0);
    }

    function clearEntriesAfter(level) {
        stack.length = level;
    }

    function getSize() {
        return stack.length;
    }

    function invalidate() {
        clear();
        data.desired_key = undefined;
        data.loaded_key = undefined;
        data.absolute_position = -1n;
        data.absolute_start_position = -1n;
        data.absolute_end_position = -1n;
    }

    function asString() {
        return {
            stack,
            desired_key: data.desired_key,
            loaded_key: data.loaded_key,
            absolute_position: data.absolute_position,
            absolute_start_position: data.absolute_start_position,
            absolute_end_position: data.absolute_end_position,
        };
    }


    const data = {

        // The stack,
        stack,

        // They key and absolute position of start or end,
        desired_key: undefined,
        loaded_key: undefined,
        absolute_position: -1n,
        absolute_start_position: -1n,
        absolute_end_position: -1n,

        createStackElement,
        pushToStack,
        getEntry,
        lastStackEntry,
        clear,
        clearEntriesAfter,
        getSize,
        invalidate,

        asString,

    };

    return data;

}




// A TreeStack presents functions for locating and reading from and writing to
// a database key/value space represented as a B-Tree. Intended to be a
// reusable resource.

function TreeStack(store, root_addr) {

    const originating_root_addr = root_addr;

    // The lock counter,
    let locked = false;

    // The current stack state,
    let ss = StackState();




    function getOriginatingRootAddr() {
        return originating_root_addr;
    }
    function getRootAddr() {
        return root_addr;
    }




    function OutOfBoundsError(msg) {
        return Error(msg);
    }





    // function keyShouldTraverse(key, left_key, right_key) {
    //     // ( key >= left_key && key < right_key )
    //     return key.compareTo(left_key) >= 0 && key.compareTo(right_key) < 0;
    // }



    // Iterate over the branch data and determine the branch to traverse to find
    // the start of the given key span.
    async function loadKeyStart(
                key, branch_addr, stack_level,
                left_offset, outer_left_key, outer_right_key ) {

        // Get the node data,
        const node_data = await store.get(branch_addr);
        const size = node_data.getSize();

        // Get first reference,
        let n = 0;

        let left_key = outer_left_key;

        while (n + 40 < size) {

            const down_addr = node_data.readAddr(n);
            n += 16;
            const down_size = node_data.readBigInt(n);
            n += 8;
            const right_key = node_data.readValue128(n);
            n += 16;

            // Should we traverse at this point?
            if ( key.compareTo( right_key ) <= 0 ) {
                ss.pushToStack(stack_level, n - 40, down_addr, down_size, left_offset, left_key, right_key);
                return down_addr;
            }

            // Transition to the next key,
            left_key = right_key;
            left_offset += down_size;

        }

        // Handle the tail of the branch node,

        const down_addr = node_data.readAddr(n);
        n += 16;
        const down_size = node_data.readBigInt(n);
        n += 8;
        const right_key = outer_right_key;

        // Should we traverse at this point?
        if ( key.compareTo( right_key ) <= 0 ) {
            ss.pushToStack(stack_level, n - 24, down_addr, down_size, left_offset, left_key, right_key);
            return down_addr;
        }

        // This is a corruption. This branch contains keys out of the scope of
        // the parent.
        throw Error("Branch has Keys outside the scope of the parent");

    }

    // Iterate over the branch data and determine the branch to traverse to find
    // the end position of the given key span. Note that this will always land
    // on the first key immediately following 'key'.
    async function loadKeyEnd(
                key, branch_addr, stack_level,
                outer_left_offset, outer_left_key, outer_right_key ) {

        // Get the node data,
        const node_data = await store.get(branch_addr);
        const size = node_data.getSize();

        // Compute absolute byte size of all children,
        let left_offset = outer_left_offset;
        const down_size_arr = [];
        for (let i = 16; i < size; i += 40) {
            const down_size = node_data.readBigInt(i);
            down_size_arr.push(down_size);
            left_offset += down_size;
        }

        // Get last reference,
        let n = size - 40;
        let ds_i = down_size_arr.length - 1;

        let right_key = outer_right_key;

        while (n > 0) {

            const left_key = node_data.readValue128(n);
            n += 16;
            const down_addr = node_data.readAddr(n);
            n += 16;
            const down_size = down_size_arr[ds_i];
            n += 8;

            left_offset -= down_size;

            // Should we traverse at this point?
            if ( key.compareTo( left_key ) >= 0 ) {
                ss.pushToStack(stack_level, n - 24, down_addr, down_size, left_offset, left_key, right_key);
                return down_addr;
            }

            // Transition to the previous key,
            right_key = left_key;

            n -= (40 + 40);
            --ds_i;

        }

        // Handle the head of the branch node,

        const left_key = outer_left_key;
        n += 16;
        const down_addr = node_data.readAddr(n);
        n += 16;
        const down_size = down_size_arr[0];
        n += 8;

        left_offset -= down_size;

        // Should we traverse at this point?
        if ( key.compareTo( left_key ) >= 0 ) {
            ss.pushToStack(stack_level, n - 24, down_addr, down_size, left_offset, left_key, right_key);
            return down_addr;
        }

        // This is a corruption. This branch contains keys out of the scope of
        // the parent.
        throw Error("Branch has Keys outside the scope of the parent");

    }





    async function loadAbsolutePosition(
                absolute_pos, branch_addr, stack_level,
                outer_left_offset, outer_left_key, outer_right_key ) {

        // Get the node data,
        const node_data = await store.get(branch_addr);
        const size = node_data.getSize();

        // Iterate over children and compute absolute byte position,
        let left_offset = outer_left_offset;

        let offset = 0;
        for (; offset < size - 24; offset += 40) {
            const down_size = node_data.readBigInt(offset + 16);
            if ( absolute_pos < left_offset + down_size ) {
                break;
            }
            left_offset += down_size;
        }

        let left_key, right_key;

        if (offset === 0) {
            left_key = outer_left_key;
        }
        else {
            left_key = node_data.readValue128(offset - 16);
        }

        if (offset + 24 >= size) {
            right_key = outer_right_key;
        }
        else {
            right_key = node_data.readValue128(offset + 24);
        }

        const down_addr = node_data.readAddr(offset);
        const down_size = node_data.readBigInt(offset + 16);

        ss.pushToStack(stack_level, offset, down_addr, down_size, left_offset, left_key, right_key);
        return down_addr;

    }





    function currentLeafNodeInfo() {
        const last_stack_entry = ss.lastStackEntry();
        return {
            // The key of the node,
            key: last_stack_entry.right_key,
            // The previous key,
            previous_key: last_stack_entry.left_key,
            // The size of the leaf node ( this is -1 if empty tree ),
            size: last_stack_entry.down_size,
            // BigInt Offset of node in global address space,
            offset: last_stack_entry.left_offset,
            // Address of the leaf node,
            addr: last_stack_entry.down_addr
        };
    }




    // Sets up the internal state in preparation for some operation on the
    // given key. If the key has at least one leaf node present in the tree,
    // loaded_key will equal desired_key, and absolute_start_position will
    // be the current absolute position of the key data in the global address
    // space. If the key is not present in the tree, loaded_key will equal
    // the immediate key after the desired_key in the tree, and
    // absolute_start_position will be the current absolute start position of
    // the loaded_key data.

    async function stackLoadToStartOfKey(key) {

        // Key must be > MIN_KEY and < MAX_KEY
        if ( key.isEqual(FAR_LEFT_KEY) || key.isEqual(FAR_RIGHT_KEY) ) {
            throw OutOfBoundsError("key out of range");
        }

        ss.desired_key = undefined;
        ss.loaded_key = undefined;
        ss.absolute_position = -1n;
        ss.absolute_start_position = -1n;
        ss.absolute_end_position = -1n;

        // --- populateStackForKey start ---

        // Clear the stack,
        ss.clear();

        // Push root branch to stack,
        let branch_addr = root_addr;
        ss.pushToStack(0, -1, branch_addr, -1n, 0n, FAR_LEFT_KEY, FAR_RIGHT_KEY);

        let stack_level = 1;
        // Repeat until we hit a leaf node address,
        while ( isBranchNodeAddr( branch_addr ) ) {

            const prev_stack_entry = ss.getEntry( stack_level - 1 );

            const left_offset = prev_stack_entry.left_offset;
            const left_key = prev_stack_entry.left_key;
            const right_key = prev_stack_entry.right_key;

            // Load next level of stack,
            branch_addr = await loadKeyStart(
                        key, branch_addr, stack_level,
                        left_offset, left_key, right_key );

            // Next stack level,
            ++stack_level;

        }
        // await populateStackForKey(key);

        // --- populateStackForKey end ---

        // Get info about the leaf node we landed on,
        const leaf_node_info = currentLeafNodeInfo();

        ss.desired_key = key;
        ss.loaded_key = leaf_node_info.key;

        // Did we land on the same key we are searching for?
        if ( leaf_node_info.key.isEqual(key) ) {

            // Start of current,
            ss.absolute_position = leaf_node_info.offset;
            ss.absolute_start_position = leaf_node_info.offset;
            ss.absolute_end_position = -1n;

            // Stack should now be setup correctly,

        }
        // Didn't land on key, therefore means the key has 0 size,
        else {

            // console.log("END OF PREVIOUS!");
            // console.log("leaf_node_info =", leaf_node_info);

            // We are at start of the next node,
            ss.absolute_position = leaf_node_info.offset;
            ss.absolute_start_position = leaf_node_info.offset;
            ss.absolute_end_position = leaf_node_info.offset;

            // Stack should be setup correctly,

        }


    }


    // Sets up the internal state in preparation for some operation on the
    // given key. If the key has at least one leaf node present in the tree,
    // loaded_key will equal desired_key, and absolute_end_position will
    // be the current absolute position of the key data end in the global
    // address space. If the key is not present in the tree, loaded_key will
    // equal the immediate key after the desired_key in the tree, and
    // absolute_start_position and absolute_end_position will be the current
    // absolute start and end position of the loaded_key data.

    async function stackLoadToEndOfKey(key) {

        // Key must be > MIN_KEY and < MAX_KEY
        if ( key.isEqual(FAR_LEFT_KEY) || key.isEqual(FAR_RIGHT_KEY) ) {
            throw OutOfBoundsError("key out of range");
        }

        ss.desired_key = undefined;
        ss.loaded_key = undefined;
        ss.absolute_position = -1n;
        ss.absolute_start_position = -1n;
        ss.absolute_end_position = -1n;

        // --- populateStackForKey start ---

        // Clear the stack,
        ss.clear();

        // Push root branch to stack,
        let branch_addr = root_addr;
        ss.pushToStack(0, -1, branch_addr, -1n, 0n, FAR_LEFT_KEY, FAR_RIGHT_KEY);

        let stack_level = 1;
        // Repeat until we hit a leaf node address,
        while ( isBranchNodeAddr( branch_addr ) ) {

            const prev_stack_entry = ss.getEntry( stack_level - 1 );

            const left_offset = prev_stack_entry.left_offset;
            const left_key = prev_stack_entry.left_key;
            const right_key = prev_stack_entry.right_key;

            // Load next level of stack,
            branch_addr = await loadKeyEnd(
                        key, branch_addr, stack_level,
                        left_offset, left_key, right_key );

            // Next stack level,
            ++stack_level;

        }
        // await populateStackForKey(key);

        // --- populateStackForKey end ---

        // Get info about the leaf node we landed on,
        const leaf_node_info = currentLeafNodeInfo();

        ss.desired_key = key;

        // Did we land on the same key we are searching for?
        if ( leaf_node_info.previous_key.isEqual(key) ) {

            ss.loaded_key = leaf_node_info.previous_key;

            // Start of current,
            ss.absolute_position = leaf_node_info.offset;
            ss.absolute_start_position = -1n;
            ss.absolute_end_position = leaf_node_info.offset;

            // Stack should now be setup correctly,

        }
        // Didn't land on key, therefore means the key has 0 size,
        else {

            ss.loaded_key = leaf_node_info.key;

            // console.log("END OF PREVIOUS!");
            // console.log("leaf_node_info =", leaf_node_info);

            // We are at start of the next node,
            ss.absolute_position = leaf_node_info.offset;
            ss.absolute_start_position = leaf_node_info.offset;
            ss.absolute_end_position = leaf_node_info.offset;

            // Stack should be setup correctly,

        }

    }




    // Traverse forward by the given amount of bytes, updating the stack and
    // internal absolute state variables as appropriate.

    async function traverseToAbsolutePosition(key, absolute_pos) {

        // console.log("Key: ", key, " Traverse To: ", absolute_pos);
        // console.log("BEFORE:");
        // debugDumpStackState(console.log);

        // Handle the simple case of simply moving within the current node.

        const entry = ss.lastStackEntry();
        const node_left_absolute_pos = entry.left_offset;
        const node_right_absolute_pos = node_left_absolute_pos + entry.down_size;

        // If we are traversing somewhere outside the current node,
        if ( absolute_pos < node_left_absolute_pos ||
             absolute_pos >= node_right_absolute_pos ) {

            // Default is the full range,
            let stack_level = ss.getSize() - 1;
            // let branch_left_absolute_position = 0n;
            // let branch_right_absolute_position = -1n;

            // Trace back through stack until we at the level that encompasses
            // the range of the position being traversed to,
            if (stack_level > 1) {

                for ( ; stack_level > 1; --stack_level ) {

                    // const entry = ss.getEntry( stack_level );
                    const entry_back_one = ss.getEntry( stack_level - 1 );

                    const calc_branch_left_absolute_position =
                                entry_back_one.left_offset;
                    const calc_branch_right_absolute_position =
                                entry_back_one.left_offset + entry_back_one.down_size;

                    if ( absolute_pos >= calc_branch_left_absolute_position &&
                         absolute_pos < calc_branch_right_absolute_position ) {

                        // branch_left_absolute_position = calc_branch_left_absolute_position;
                        // branch_right_absolute_position = calc_branch_right_absolute_position;

                        // Regen stack from this position,
                        break;

                    }

                }

            }

            // Clear all stack entries after this stack level,
            ss.clearEntriesAfter(stack_level);

            let branch_addr = ss.getEntry( stack_level - 1 ).down_addr;

            // Fill out the stack until we hit a leaf node address,
            while ( isBranchNodeAddr( branch_addr ) ) {

                const prev_stack_entry = ss.getEntry( stack_level - 1 );

                const left_offset = prev_stack_entry.left_offset;
                const left_key = prev_stack_entry.left_key;
                const right_key = prev_stack_entry.right_key;

                // Load next level of stack,
                branch_addr = await loadAbsolutePosition(
                            absolute_pos, branch_addr, stack_level,
                            left_offset, left_key, right_key );

                // Next stack level,
                ++stack_level;

            }

            // Get info about the leaf node we landed on,
            const last_entry = ss.lastStackEntry();

            // Did we land on a boundary and is the left key the same as
            // the key we are searching?
            // This handles the special case where right_key is not the key
            // we are representing, and the left_key is ( which is the case
            // when the position is at the end of the node sequence ).

            if ( last_entry.left_offset === absolute_pos &&
                 key.isEqual( last_entry.left_key ) === true ) {

                ss.loaded_key = key;

            }
            else {

                ss.loaded_key = last_entry.right_key;

            }

        }

        // Update the absolute position pointer,
        ss.absolute_position = absolute_pos;

        // console.log("AFTER:");
        // debugDumpStackState(console.log);

    }











    // Returns true if no more children can be added to this branch node,
    function isBranchAtCapacity( node_buf, key, absolute_pos ) {
        return ( node_buf.getSize() >= (MAX_BRANCH_CHILDREN * 40) + 24 );
    }

    // Create a new root branch node buffer,

    function createNewRootBranch( branch_info ) {

        const branch_buffer = store.createEmptyDataBuffer( BRANCH );

        branch_buffer.writeAddr(     branch_info[0], 0 );
        branch_buffer.writeBigInt(   branch_info[1], 0 + 16 );
        branch_buffer.writeValue128( branch_info[2], 0 + 16 + 8 );
        branch_buffer.writeAddr(     branch_info[3], 0 + 16 + 8 + 16 );
        branch_buffer.writeBigInt(   branch_info[4], 0 + 16 + 8 + 16 + 16 );

        return branch_buffer;

    }


    function insertIntoBranch(branch_buffer, offset, address_key_set) {

        // Whether we are inserting a single or double, we need room for
        // 40 bytes,
        branch_buffer.shift(40, offset);

        branch_buffer.writeAddr(     address_key_set[0], offset );
        branch_buffer.writeBigInt(   address_key_set[1], offset + 16 );
        branch_buffer.writeValue128( address_key_set[2], offset + 16 + 8 );
        if (address_key_set.length > 3) {
            branch_buffer.writeAddr(     address_key_set[3], offset + 16 + 8 + 16 );
            branch_buffer.writeBigInt(   address_key_set[4], offset + 16 + 8 + 16 + 16 );
        }

    }


    async function splitAdjustDownSize( stack_level, size ) {

        for (let se = stack_level; se >= 1; --se) {
            const sentry = ss.getEntry(se);
            sentry.down_size += size;
            const branch_buf = await store.get( ss.getEntry(se - 1).down_addr );
            branch_buf.writeBigInt( sentry.down_size, sentry.addr_offset + 16 );
        }

    }

    function calculateBranchTotalByteSize(branch_node_buf) {

        let size_tally = 0n;

        const size = branch_node_buf.getSize();
        for (let p = 0; p < size; p += 40) {
            size_tally += branch_node_buf.readBigInt(p + 16);
        }

        return size_tally;

    }



    // Performs a split insert operation on the tree at the given absolute
    // position. 'address_key_set' is the address/key sequence to insert
    // into the branch. This function is called recursively.
    //
    // Assumes the stack is set up such that it is positioned on the key and
    // absolute_position.
    //
    // This function make not actually perform a split operation if there is
    // enough room on the branch to hold the given address/key sequence.
    // The sequence may either be 'Addr, size, Key' or
    // 'Addr, size, Key, Addr, size'.
    //
    // Returns true if calling this function caused a split.

    async function splitInsert( stack_level, address_key_set, byte_size_increase, side ) {

        const previous_se = ss.getEntry( stack_level - 1 );
        const current_se = ss.getEntry( stack_level );

        const branch_addr = previous_se.down_addr;
        const branch_buffer = await store.get( branch_addr );

        // Where to insert,
        const offset = current_se.addr_offset;

        const needs_split = isBranchAtCapacity( branch_buffer );

        if ( needs_split ) {

            // console.log("SPLIT Happening!");
            // console.log("Original: ", branchAsString(branch_buffer) );

            // Split the branch node at the midpoint,
            // Make sure to avoid splitting at the offset,

            const right_branch_buffer = store.createEmptyDataBuffer( BRANCH );

            let midpoint_offset = ( ( ( MAX_BRANCH_CHILDREN / 2 ) | 0 ) * 40 );
            // If midpoint is the same as insert point, move midpoint to next
            // child address,
            if ( midpoint_offset === offset ) {
                midpoint_offset += 40;
            }

            // Stack level needs to shift to right branch,
            const offset_on_right_branch = ( offset > midpoint_offset );

            const midpoint_key = branch_buffer.readValue128( midpoint_offset + 24 );

            // Copy data to next branch buffer from branch_buffer,
            right_branch_buffer.copyFromDataBuffer(
                    branch_buffer,
                    midpoint_offset + 40,
                    branch_buffer.getSize() - (midpoint_offset + 40),
                    0
                );
            // Truncate the left branch,
            branch_buffer.setSize( midpoint_offset + 24 );

            // Now we have split buffer that we can insert the address_key_set
            // into,

            if ( offset_on_right_branch ) {
                // Insert to right branch,
                const modified_offset = offset - midpoint_offset - 40;
                current_se.addr_offset = modified_offset + (side * 40);
                current_se.left_key = midpoint_key;
                insertIntoBranch( right_branch_buffer,
                                  modified_offset,
                                  address_key_set );
            }
            else {
                // Insert to left branch,
                current_se.right_key = midpoint_key;
                current_se.addr_offset += (side * 40);
                insertIntoBranch( branch_buffer,
                                  offset,
                                  address_key_set );
            }

            current_se.down_addr = address_key_set[ side * 3 ];
            current_se.down_size = address_key_set[ ( side * 3 ) + 1 ];

            // console.log("Left: ", branchAsString(branch_buffer) );
            // console.log("Right: ", branchAsString(right_branch_buffer) );
            // console.log("Middle Key: ", midpoint_key );



            const left_addr = branch_addr;
            const left_size = calculateBranchTotalByteSize( branch_buffer );
            const right_addr = right_branch_buffer.getAddr();
            const right_size = calculateBranchTotalByteSize( right_branch_buffer );

            // Split info for when we recurse,
            const split_info = [ left_addr, left_size,
                                 midpoint_key,
                                 right_addr, right_size ];

            // If not yet at the top of the stack,
            if (stack_level > 1) {

                // Recurse to the previous stack level,
                await splitInsert( stack_level - 1,
                                   split_info,
                                   byte_size_increase,
                                   offset_on_right_branch ? 1 : 0   // side
                                 );

            }
            else {

                // Otherwise at the top, so make a new root address,
                const new_root_branch = createNewRootBranch( split_info );
                const new_root_addr = new_root_branch.getAddr();

                // Insert into the stack,
                ss.stack.unshift(ss.getEntry(0));

                // stack[0] is special case that only needs 'down_addr' set,
                ss.getEntry(0).down_addr = new_root_addr;

                const calc_side = offset_on_right_branch ? 1 : 0;

                ss.stack[1] = ss.createStackElement(
                    (calc_side * 40),                                  // addr_offset
                    split_info[ calc_side * 3 ],                       // down_addr
                    split_info[ ( calc_side * 3 ) + 1 ],               // down_size
                    (calc_side === 0) ? 0n : split_info[1],            // left_offset
                    (calc_side === 0) ? FAR_LEFT_KEY : split_info[2],  // left_key
                    (calc_side === 0) ? split_info[2] : FAR_RIGHT_KEY  // right_key
                );

                root_addr = new_root_addr;

            }


        }
        else {

            // There's room here to hold the address_key_set, so insert it into
            // the branch,

            current_se.down_addr = address_key_set[ side * 3 ];
            current_se.down_size = address_key_set[ ( side * 3 ) + 1 ];
            if (side === 0) {
                // Little hacky, make sure to set right_key for the guaranteed
                // case when we setting reference to the leaf node,
                current_se.right_key = address_key_set[2];
            }
            current_se.addr_offset += (side * 40);

            insertIntoBranch( branch_buffer,
                              offset,
                              address_key_set );

            if (byte_size_increase !== 0) {
                await splitAdjustDownSize( stack_level - 1, byte_size_increase );
            }

        }

        return needs_split;

    }






    // Inserts a new leaf node into the tree with the given Key and at the
    // current position,
    async function insertLeafNodeToTree(key, absolute_pos, leaf_node_buffer) {

        const leaf_addr = leaf_node_buffer.getAddr();
        const leaf_size = BigInt64( leaf_node_buffer.getSize() );

        const address_key_set = [ leaf_addr, leaf_size, key ];

        const did_split = await splitInsert(
                            ss.getSize() - 1, address_key_set, leaf_size, 0 );

        // Make sure 'loaded_key' is refreshed,
        ss.loaded_key = key;

    }






    // Ensures that the current stack structure contains references to
    // in-memory nodes only. Doesn't materialize the leaf node.
    async function ensureMutableStack() {

        let next_addr = ss.getEntry(0).down_addr;

        let last_im_data;

        // Iterate through the stack,
        for ( let i = 1; i < ss.getSize(); ++i ) {

            // Can this address me converted to a buffer?
            let im_data;

            if ( store.canConvertToBuffer(next_addr) ) {
                im_data = store.convertSpanToBuffer(
                                            await store.get( next_addr ) );
                const new_addr = im_data.getAddr();
                const stack_back_one = ss.getEntry( i - 1 );
                stack_back_one.down_addr = new_addr;
                if (last_im_data !== undefined) {
                    last_im_data.writeAddr( new_addr, stack_back_one.addr_offset );
                }
                else {
                    // Update root_addr,
                    root_addr = new_addr;
                }
            }
            else {
                im_data = await store.get( next_addr );
            }

            // Go to next,
            next_addr = ss.getEntry(i).down_addr;
            last_im_data = im_data;

        }

        return next_addr;

    }


    async function ensureMutableStackAndLeaf() {

        const leaf_addr = await ensureMutableStack();

        // Make the leaf mutable if necessary,

        if ( store.canConvertToBuffer(leaf_addr) ) {

            const stack_back_two = ss.getEntry( ss.getSize() - 2 );
            const last_im_data = await store.get( stack_back_two.down_addr );

            const im_data = store.convertSpanToBuffer(
                                            await store.get(leaf_addr) );
            const new_addr = im_data.getAddr();
            const stack_back_one = ss.lastStackEntry();
            stack_back_one.down_addr = new_addr;
            last_im_data.writeAddr( new_addr, stack_back_one.addr_offset );

        }

    }


    // Setup for position,
    async function setupStackForRelativePosition(key, relative_position) {

        if (relative_position < 0n) {
            // Position relative to end,
            await stackLoadToEndOfKey(key);
            if (relative_position < -1n) {
                await traverseToAbsolutePosition(
                        key, ss.absolute_end_position + relative_position + 1n);
            }
        }
        else {
            // Position relative to start,
            await stackLoadToStartOfKey(key);
            if (relative_position > 0) {
                await traverseToAbsolutePosition(
                        key, ss.absolute_start_position + relative_position);
            }
        }

    }

    // Returns current relative position,
    function getRelativePosition() {
        if (ss.absolute_start_position === -1n) {
            // Relative from end,
            return ss.absolute_position - ss.absolute_end_position - 1n;
        }
        else {
            // Relative from start,
            return ss.absolute_position - ss.absolute_start_position;
        }
    }



    // Reads data from the buffer and writes out to the key value at the
    // current position.
    async function copyFromBuffer(buf, offset, size) {

        // Assert stack loaded,
        if (ss.getSize() === 0) {
            throw Error("Stack not populated");
        }

        // Sanity checks,
        if ( size > ( buf.length - offset ) ) {
            throw Error("size to copy greater than buffer size");
        }

//        console.log("BEFORE:");
//        dumpStackState(console.log);

        const change_position_amount = BigInt64( size );

        // If there's no leaf node yet for the desired key,
        if ( !ss.desired_key.isEqual( ss.loaded_key ) ) {

            // This is the case when there's no data currently stored in the
            // tree for the desired_key.

            // There's no existing leaf data to copy the data into, so create
            // leaf node(s) and insert into tree.

            // Insert key,
            await ensureMutableStack();

            const leaf_buf_set = [];

            // Calculate the number of new nodes we will need to create to
            // store the given amount of data.
            const max_node_size = store.getNodeDataByteSizeLimit();
            const node_count = ( ( ( size - 1 ) / max_node_size ) | 0 ) + 1;

            let noff = offset;
            let nsize = size;

            for ( let i = 0; i < node_count; ++i ) {

                // Create a leaf node,
                const new_leaf_node_buf = store.createEmptyDataBuffer( LEAF );

                // Write into the buffer,
                const nl_size = Math.min( max_node_size, nsize );
                new_leaf_node_buf.copyFromBuffer( buf, noff, nl_size, 0 );

                // Progress the offset through the original data,
                noff += max_node_size;
                nsize -= max_node_size;

                leaf_buf_set.push(new_leaf_node_buf);

            }

            // Insert leaf node(s) in reverse order,
            for ( let i = leaf_buf_set.length - 1; i >= 0; --i ) {
                // Insert node into tree,
                const new_leaf_node_buf = leaf_buf_set[i];
                await insertLeafNodeToTree(
                            ss.desired_key, ss.absolute_start_position,
                            new_leaf_node_buf);
            }

            // Change 'absolute_end_position',
            if (ss.absolute_end_position >= 0n) {
                ss.absolute_end_position += change_position_amount;
            }

//            debugDumpStackState(console.log);

        }
        else {

            // Found the key, so we need to copy the data from the buffer into
            // the existing leaf node.

            // Ensure the stack and leaf are mutable,
            await ensureMutableStackAndLeaf();

            //

            throw Error("PENDING: Write to existing.");


        }

        // Move forward position by the size we wrote,

        await traverseToAbsolutePosition(
                    ss.desired_key,
                    ss.absolute_position + change_position_amount);


        // console.log("AFTER:");
        // debugDumpStackState(console.log);
        //
        // await debugDumpTreeBranches(console.log);

    }


    // Writes a string at the given position,

    /* async */ function writeString(str, encoding) {

        if (encoding === undefined) {
            encoding = DEFAULT_STRING_ENCODING;
        }

        // Write the string to a Buffer,
        const buf = Buffer.from(str, encoding);

        // Write the buffer,
        return copyFromBuffer(buf, 0, buf.length);

    }

    async function readString(length, encoding) {

        throw Error("PENDING: readString");

    }





    function recurseGetAllInMemoryAddresses(
                        addr, branch_buf, out_branch_addrs, out_leaf_addrs) {

        const branch_inmemory_addrs = [];

        const size = branch_buf.getSize();
        for ( let i = 0; i < size; i += 40 ) {
            const child_addr = branch_buf.readAddr(i);
            if ( isStoreAddr(child_addr) !== true ) {
                if ( isBranchNodeAddr(child_addr) === true ) {
                    out_branch_addrs.push(child_addr);
                    branch_inmemory_addrs.push(child_addr);
                }
                else {
                    out_leaf_addrs.push(child_addr);
                }
            }
        }

        // Fetch all in memory addresses,
        const branch_bufs = store.getAllDataBuffers(branch_inmemory_addrs);
        // Recursive on each addr/buf set,
        for ( let i = 0; i < branch_bufs.length; ++i ) {
            recurseGetAllInMemoryAddresses(
                        branch_inmemory_addrs[i], branch_bufs[i],
                        out_branch_addrs, out_leaf_addrs);
        }

    }

    // Returns the set of all addresses of in-memory buffers in the current
    // tree. Orders the set by branches first (left to right), then leaf
    // nodes (left to right).

    function getAllInMemoryAddresses() {
        const out_branch_addrs = [];
        const out_leaf_addrs = [];
        if (isStoreAddr(root_addr) !== true) {
            out_branch_addrs.push(root_addr);
            const branch_buf = store.getAllDataBuffers( [root_addr] )[0];
            recurseGetAllInMemoryAddresses(root_addr, branch_buf, out_branch_addrs, out_leaf_addrs);

        }
        return out_branch_addrs.concat(out_leaf_addrs);
    }




    // ----- Debugging -----

    async function recurseDumpTreeBranches(addr, levels, i) {
        if (isBranchNodeAddr(addr)) {
            const branch_node_data = await store.get(addr);
            let larr = levels[i];
            if (larr === undefined) {
                larr = [];
                levels[i] = larr;
            }
            larr.push(branch_node_data);
            for (let n = 0; n < branch_node_data.getSize(); n += 40) {
                const child_addr = branch_node_data.readAddr(n);
                await recurseDumpTreeBranches(child_addr, levels, i + 1);
            }
        }
    }

    function branchAsString(branch_node_data) {
        let out = '[ ';
        let n = 0;
        for (; n < branch_node_data.getSize() - 24; n += 40) {
            const child_addr = branch_node_data.readAddr(n);
            const child_size = branch_node_data.readBigInt(n + 16);
            const key = branch_node_data.readAddr(n + 24);
            out += child_addr.asString();
            out += ' ';
            out += child_size;
            out += ' ';
            out += key.asString();
            out += ' ';
        }
        const child_addr = branch_node_data.readAddr(n);
        const child_size = branch_node_data.readBigInt(n + 16);
        out += child_addr.asString();
        out += ' ';
        out += child_size;
        out += ' ]';

        return out;
    }

    async function debugDumpTreeBranches(println) {
        const addr = root_addr;
        const levels = [];
        await recurseDumpTreeBranches(addr, levels, 0);
        let levelc = 1;
        for (const larr of levels) {
            println("-- ", levelc);
            for (const l of larr) {
                println( branchAsString(l) );
            }
            ++levelc;
        }
    }


    function debugDumpStackState(println) {
        println(ss.asString());
    }



    async function recurseIntegrityCheck(addr) {

        if ( isBranchNodeAddr(addr) ) {

            const node_buf = await store.get(addr);
            const size = node_buf.getSize();

            let this_computed_bytesize = 0n;

            for (let i = 0; i < size; i += 40) {

                const child_addr = node_buf.readAddr(i);
                const recorded_bytesize = node_buf.readBigInt(i + 16);

                const checked_child_bytesize = await recurseIntegrityCheck(child_addr);

                if (recorded_bytesize !== checked_child_bytesize) {
                    throw Error("Integrity failed: branch size does not equal computed size.");
                }

                this_computed_bytesize += recorded_bytesize;

            }

            return this_computed_bytesize;

        }
        else {

            const node_buf = await store.get(addr);
            return BigInt64( node_buf.getSize() );

        }

    }


    async function debugCheckTreeIntegrity() {
        const addr = root_addr;
        return await recurseIntegrityCheck(addr);
    }





    // Locking feature to help prevent asynchronous access to the stack state.

    function lock() {
        if (locked === true) {
            throw Error('Multiple locks on TreeStack. Synchronous access is required.');
        }
        locked = true;
    }

    function unlock() {
        if (locked === false) {
            throw Error('Unlock called while unlocked indicates synchronous issue.');
        }
        locked = false;
    }

    function invalidate() {
        root_addr = undefined;
        ss.invalidate();
    }



    return {

        lock,
        unlock,

        invalidate,

        setupStackForRelativePosition,
        getRelativePosition,

//        stackLoadToEndOfKey,          // async

//        stackLoadToKeyPosition,       // async


        writeString,     // async
        readString,      // async

//        readUInt8,       // async
//        writeUInt8,      // async
//        copyToBuffer,    // async
        copyFromBuffer,  // async


        getAllInMemoryAddresses,
        getRootAddr,
        getOriginatingRootAddr,

        debugCheckTreeIntegrity,   // async
        debugDumpTreeBranches,     // async
        debugDumpStackState

    };

}

module.exports = TreeStack;
