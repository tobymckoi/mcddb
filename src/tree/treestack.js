"use strict";

const { KeyStatics } = require('./key.js');

const { isBranchNodeAddr,
        isStoreAddr,
        PROC_EMPTY_TREE_ADDR
      } = require('../store/addr.js');

const Int64 = require('../util/int64.js');

const { calculateUTF8CodePointSize,
        readUTF8StringFromBuffer,
      } = require('../util/general.js');


// Get KeyStatics for far left and right key,
const { FAR_LEFT_KEY, FAR_RIGHT_KEY } = KeyStatics;

// Maximum children per branch,
const MAX_BRANCH_CHILDREN = 19;    // 80
const MIN_BRANCH_CHILDREN = 7;     // 35

const LEAF = false;
const BRANCH = true;

const DEFAULT_STRING_ENCODING = 'utf8';

// This is about 256MB which is V8 limit,
const MAX_READ_STRING_LENGTH = (1 << 28) - 16;




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
        data.absolute_position = Int64.NEG_ONE;
        data.absolute_start_position = Int64.NEG_ONE;
        data.absolute_end_position = Int64.NEG_ONE;
    }

    function copyFrom(in_stack) {

        clear();

        const len = in_stack.getSize();
        for (let i = 0; i < len; ++i) {
            const se = in_stack.getEntry(i);
            pushToStack( i, se.addr_offset,
                         se.down_addr, se.down_size, se.left_offset,
                         se.left_key, se.right_key );
        }
        data.desired_key = in_stack.desired_key;
        data.loaded_key = in_stack.loaded_key;
        data.absolute_position = in_stack.absolute_position;
        data.absolute_start_position = in_stack.absolute_start_position;
        data.absolute_end_position = in_stack.absolute_end_position;

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
        absolute_position: Int64.NEG_ONE,
        absolute_start_position: Int64.NEG_ONE,
        absolute_end_position: Int64.NEG_ONE,

        createStackElement,
        pushToStack,
        getEntry,
        lastStackEntry,
        clear,
        clearEntriesAfter,
        getSize,
        invalidate,

        copyFrom,
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

    function positionOutOfBoundsError() {
        return OutOfBoundsError("Position out of bounds");
    }



    // function keyShouldTraverse(key, left_key, right_key) {
    //     // ( key >= left_key && key < right_key )
    //     return key.compareTo(left_key) >= 0 && key.compareTo(right_key) < 0;
    // }


    // Fetch node within the context of the current lock. The implication
    // being that an 'unlock' might flush nodes out to the storage medium if
    // there is pressure on local memory.

    /* async */ function fetchNode(addr) {
        return store.get(addr);
    }





    // Iterate over the branch data and determine the branch to traverse to find
    // the start of the given key span.
    async function loadKeyStart(
                key, branch_addr, stack_level,
                left_offset, outer_left_key, outer_right_key ) {

        // Get the node data,
        const node_data = await fetchNode(branch_addr);
        const size = node_data.getSize();

        // Get first reference,
        let n = 0;

        let left_key = outer_left_key;

        while (n + 40 < size) {

            const down_addr = node_data.readAddr(n);
            n += 16;
            const down_size = node_data.readInt64(n);
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
            left_offset = left_offset.add( down_size );

        }

        // Handle the tail of the branch node,

        const down_addr = node_data.readAddr(n);
        n += 16;
        const down_size = node_data.readInt64(n);
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
        const node_data = await fetchNode(branch_addr);
        const size = node_data.getSize();

        // Compute absolute byte size of all children,
        let left_offset = outer_left_offset;
        const down_size_arr = [];
        for (let i = 16; i < size; i += 40) {
            const down_size = node_data.readInt64(i);
            down_size_arr.push(down_size);
            left_offset = left_offset.add( down_size );
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

            left_offset = left_offset.sub( down_size );

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

        left_offset = left_offset.sub( down_size );

        // Should we traverse at this point?
        if ( key.compareTo( left_key ) >= 0 ) {
            ss.pushToStack(stack_level, n - 24, down_addr, down_size, left_offset, left_key, right_key);
            return down_addr;
        }

        // This is a corruption. This branch contains keys out of the scope of
        // the parent.
        throw Error("Branch has Keys outside the scope of the parent");

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
            // Int64 Offset of node in global address space,
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
        if ( key.eq(FAR_LEFT_KEY) || key.eq(FAR_RIGHT_KEY) ) {
            throw OutOfBoundsError("key out of range");
        }

        ss.desired_key = undefined;
        ss.loaded_key = undefined;
        ss.absolute_position = Int64.NEG_ONE;
        ss.absolute_start_position = Int64.NEG_ONE;
        ss.absolute_end_position = Int64.NEG_ONE;

        // --- populateStackForKey start ---

        // Clear the stack,
        ss.clear();

        // Push root branch to stack,
        let branch_addr = root_addr;
        ss.pushToStack(0, -1, branch_addr, Int64.NEG_ONE, Int64.ZERO, FAR_LEFT_KEY, FAR_RIGHT_KEY);

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
        if ( leaf_node_info.key.eq(key) ) {

            // Start of current,
            ss.absolute_position = leaf_node_info.offset;
            ss.absolute_start_position = leaf_node_info.offset;
            ss.absolute_end_position = Int64.NEG_ONE;

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
        if ( key.eq(FAR_LEFT_KEY) || key.eq(FAR_RIGHT_KEY) ) {
            throw OutOfBoundsError("key out of range");
        }

        ss.desired_key = undefined;
        ss.loaded_key = undefined;
        ss.absolute_position = Int64.NEG_ONE;
        ss.absolute_start_position = Int64.NEG_ONE;
        ss.absolute_end_position = Int64.NEG_ONE;

        // --- populateStackForKey start ---

        // Clear the stack,
        ss.clear();

        // Push root branch to stack,
        let branch_addr = root_addr;
        ss.pushToStack(0, -1, branch_addr, Int64.NEG_ONE, Int64.ZERO, FAR_LEFT_KEY, FAR_RIGHT_KEY);

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
        if ( leaf_node_info.previous_key.eq(key) ) {

            ss.loaded_key = leaf_node_info.previous_key;

            // Start of current,
            ss.absolute_position = leaf_node_info.offset;
            ss.absolute_start_position = Int64.NEG_ONE;
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



    function loadAbsolutePosition(
                stack,
                absolute_pos, node_data, stack_level,
                outer_left_offset, outer_left_key, outer_right_key ) {

        const size = node_data.getSize();

        // Iterate over children and compute absolute byte position,
        let left_offset = outer_left_offset;

        let offset = 0;
        for (; offset < size - 24; offset += 40) {
            const down_size = node_data.readInt64(offset + 16);
            const right_offset = left_offset.add( down_size );
            if ( absolute_pos.lt( right_offset ) ) {
                break;
            }
            left_offset = left_offset.add( down_size );
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
        const down_size = node_data.readInt64(offset + 16);

        stack.pushToStack(stack_level, offset, down_addr, down_size, left_offset, left_key, right_key);
        return down_addr;

    }


    // Traverse forward to the given absolute position, updating the stack and
    // internal absolute state variables as appropriate.

    async function traverseToAbsolutePosition(stack, key, absolute_pos) {

        // console.log("Key: ", key, " Traverse To: ", absolute_pos);
        // console.log("BEFORE:");
        // debugDumpStackState(console.log);

        // Handle the simple case of simply moving within the current node.

        const entry = stack.lastStackEntry();
        const node_left_absolute_pos = entry.left_offset;
        const node_right_absolute_pos = node_left_absolute_pos.add( entry.down_size );

        // If we are traversing somewhere outside the current node,
        if ( absolute_pos.lt( node_left_absolute_pos ) ||
             absolute_pos.gte( node_right_absolute_pos ) ) {

            // Default is the full range,
            let stack_level = stack.getSize() - 1;
            // let branch_left_absolute_position = Int64.ZERO;
            // let branch_right_absolute_position = Int64.NEG_ONE;

            // Trace back through stack until we at the level that encompasses
            // the range of the position being traversed to,
            if (stack_level > 1) {

                for ( ; stack_level > 1; --stack_level ) {

                    // const entry = stack.getEntry( stack_level );
                    const entry_back_one = stack.getEntry( stack_level - 1 );

                    const calc_branch_left_absolute_position =
                                entry_back_one.left_offset;
                    const calc_branch_right_absolute_position =
                                entry_back_one.left_offset.add( entry_back_one.down_size );

                    if ( absolute_pos.gte( calc_branch_left_absolute_position ) &&
                         absolute_pos.lt( calc_branch_right_absolute_position ) ) {

                        // branch_left_absolute_position = calc_branch_left_absolute_position;
                        // branch_right_absolute_position = calc_branch_right_absolute_position;

                        // Regen stack from this position,
                        break;

                    }

                }

            }

            // Clear all stack entries after this stack level,
            stack.clearEntriesAfter(stack_level);

            let branch_addr = stack.getEntry( stack_level - 1 ).down_addr;

            // Fill out the stack until we hit a leaf node address,
            while ( isBranchNodeAddr( branch_addr ) ) {

                const prev_stack_entry = stack.getEntry( stack_level - 1 );

                const left_offset = prev_stack_entry.left_offset;
                const left_key = prev_stack_entry.left_key;
                const right_key = prev_stack_entry.right_key;

                // Get the node data,
                const node_data = await fetchNode(branch_addr);

                // Load next level of stack,
                branch_addr = loadAbsolutePosition(
                            stack,
                            absolute_pos, node_data, stack_level,
                            left_offset, left_key, right_key );

                // Next stack level,
                ++stack_level;

            }

            // Get info about the leaf node we landed on,
            const last_entry = stack.lastStackEntry();

            // Did we land on a boundary and is the left key the same as
            // the key we are searching?
            // This handles the special case where right_key is not the key
            // we are representing, and the left_key is ( which is the case
            // when the position is at the end of the node sequence ).

            if ( last_entry.left_offset.eq( absolute_pos ) &&
                 key.neq( last_entry.right_key ) &&
                 key.eq( last_entry.left_key ) ) {

                stack.loaded_key = key;

            }
            else {

                stack.loaded_key = last_entry.right_key;

            }

        }

        // Update the absolute position pointer,
        stack.absolute_position = absolute_pos;

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
        branch_buffer.writeInt64(    branch_info[1], 0 + 16 );
        branch_buffer.writeValue128( branch_info[2], 0 + 16 + 8 );
        branch_buffer.writeAddr(     branch_info[3], 0 + 16 + 8 + 16 );
        branch_buffer.writeInt64(    branch_info[4], 0 + 16 + 8 + 16 + 16 );

        return branch_buffer;

    }


    function insertIntoBranch(branch_buffer, offset, address_key_set) {

        // Whether we are inserting a single or double, we need room for
        // 40 bytes,
        branch_buffer.shift(40, offset);

        branch_buffer.writeAddr(     address_key_set[0], offset );
        branch_buffer.writeInt64(    address_key_set[1], offset + 16 );
        branch_buffer.writeValue128( address_key_set[2], offset + 16 + 8 );
        if (address_key_set.length > 3) {
            branch_buffer.writeAddr(     address_key_set[3], offset + 16 + 8 + 16 );
            branch_buffer.writeInt64(    address_key_set[4], offset + 16 + 8 + 16 + 16 );
        }

    }


    async function stackAdjustDownSize( stack_level, size ) {

        for (let se = stack_level; se >= 1; --se) {
            const sentry = ss.getEntry(se);
            sentry.down_size = sentry.down_size.add( size );
            const branch_buf = await fetchNode( ss.getEntry(se - 1).down_addr );
            branch_buf.writeInt64( sentry.down_size, sentry.addr_offset + 16 );
        }

    }

    function calculateBranchTotalByteSize(branch_node_buf) {

        let size_tally = Int64.ZERO;

        const size = branch_node_buf.getSize();
        for (let p = 0; p < size; p += 40) {
            size_tally = size_tally.add( branch_node_buf.readInt64(p + 16) );
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
        const branch_buffer = await fetchNode( branch_addr );

        // Where to insert,
        const offset = current_se.addr_offset;

        const needs_split = isBranchAtCapacity( branch_buffer );

        if ( needs_split ) {

            // console.log("SPLIT Happening!");
            // console.log("Original: ", branchAsString(branch_buffer) );

            // Split the branch node at the midpoint,
            // Make sure to avoid splitting at the offset,

            const right_branch_buffer = store.createEmptyDataBuffer( BRANCH );

            // Half point,
            let midpoint_offset = ( ( MAX_BRANCH_CHILDREN >> 1 ) * 40 );
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
                    (calc_side === 0) ? Int64.ZERO : split_info[1],    // left_offset
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

            if ( byte_size_increase.neq( Int64.ZERO ) ) {
                await stackAdjustDownSize( stack_level - 1, byte_size_increase );
            }

        }

        return needs_split;

    }






    // Inserts a new leaf node into the tree with the given Key and at the
    // current position,
    async function insertLeafNodeToTree(key, absolute_pos, leaf_node_buffer) {

        const leaf_addr = leaf_node_buffer.getAddr();
        const leaf_size = Int64.fromNumber( leaf_node_buffer.getSize() );

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
                                            await fetchNode( next_addr ) );
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
                im_data = await fetchNode( next_addr );
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
            const last_im_data = await fetchNode( stack_back_two.down_addr );

            const im_data = store.convertSpanToBuffer(
                                            await fetchNode(leaf_addr) );
            const new_addr = im_data.getAddr();
            const stack_back_one = ss.lastStackEntry();
            stack_back_one.down_addr = new_addr;
            last_im_data.writeAddr( new_addr, stack_back_one.addr_offset );

        }

    }


    // Setup for position,
    async function setupStackForRelativePosition(key, relative_position) {

        // If given relative position is negative. Position the cursor relative
        // to the end of the key.
        if ( relative_position.lt( Int64.ZERO ) ) {
            // Position relative to end,
            await stackLoadToEndOfKey(key);
            if ( relative_position.lt( Int64.NEG_ONE ) ) {
                await traverseToAbsolutePosition(
                        ss, key,
                        ss.absolute_end_position.add( relative_position ).add( Int64.ONE ) );
            }
        }
        else {
            // Position relative to start,
            await stackLoadToStartOfKey(key);
            if ( relative_position.gt( Int64.ZERO ) ) {
                await traverseToAbsolutePosition(
                        ss, key,
                        ss.absolute_start_position.add( relative_position ) );
            }
        }

    }

    // Returns current relative position,
    function getRelativePosition() {
        if ( ss.absolute_start_position.eq( Int64.NEG_ONE ) ) {
            // Relative from end,
            return ss.absolute_position.sub( ss.absolute_end_position ).sub( Int64.ONE );
        }
        else {
            // Relative from start,
            return ss.absolute_position.sub( ss.absolute_start_position );
        }
    }



    async function appendNodesForBuffer(
                buf, offset, size, max_node_size, change_position_amount) {

        const leaf_buf_set = [];

        // Calculate the number of new nodes we will need to create to
        // store the given amount of data.
        let node_count = ( ( size - 1 ) / max_node_size ) + 1;
        // Sanity check,
        if ( node_count > (2 ** 30) ) {
            throw Error("Append node allocation count exceeded limit");
        }
        node_count |= 0;

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
        if (ss.absolute_end_position.gte( Int64.ZERO ) ) {
            ss.absolute_end_position = ss.absolute_end_position.add( change_position_amount );
        }

    }


    // Reads a chunk of bytes from the current cursor into the given buffer.
    // The function will read an amount of bytes until either: 1) The
    // end of the current leaf node if bytes left >= 'min_size', 2) Read
    // 'max_size' number of bytes, 3) The end of the data stored for the key.
    // Returns the number of bytes actually written into the buffer,
    async function readChunkToBuffer(buf, offset, min_size, max_size) {

        // Assert stack loaded,
        if ( ss.getSize() === 0 ) {
            throw Error("Stack not populated");
        }

        // Sanity checks,
        if ( min_size > max_size ) {
            throw Error("min_size > max_size");
        }
        if ( max_size > ( buf.length - offset ) ) {
            throw Error("max_size greater than buffer size");
        }

        // If the cursor didn't land on the key,
        if ( ss.desired_key.neq( ss.loaded_key ) ) {
            throw positionOutOfBoundsError();
        }

        let total_read_count = 0;

        do {

            const se = ss.lastStackEntry();

            // If we reached the end,
            if ( se.right_key.neq( ss.desired_key ) ) {
                // Break the loop and return,
                break;
            }

            // The position in the leaf of the cursor,
            const int64_pos_in_leaf = ss.absolute_position.sub( se.left_offset );
            let pos_in_leaf = int64_pos_in_leaf.toInt();
            // The number of bytes left until the end of the current leaf node,
            let byte_to_leaf_end = se.down_size.sub( int64_pos_in_leaf ).toInt();

            // The amount to read,
            const read_count = Math.min( max_size, byte_to_leaf_end );
            // Assert read_count is always positive number,
            if ( read_count <= 0 ) {
                throw Error("read_count <= 0");
            }

            // Fetch the leaf node data,
            const leaf_node_buf = await fetchNode( se.down_addr );

            // How much data to read from the current leaf,
            leaf_node_buf.copyToBuffer( buf, offset, read_count, pos_in_leaf );

            // Update offset, total_read_count, and max_size,
            offset += read_count;
            total_read_count += read_count;
            max_size -= read_count;

            if (total_read_count < min_size) {
                // Traverse to the next leaf, but only if we haven't read enough
                // bytes satisfy the minimum.
                await traverseToAbsolutePosition(
                        ss, ss.desired_key,
                        ss.absolute_position.add(
                                Int64.fromNumber( read_count ) ) );
            }

        } while (total_read_count < min_size);

        // Return the number of bytes read,
        return total_read_count;

    }




    // Adds data to the end of a data node chain. This must only be used when
    // the cursor is positioned at the end point of ss.desired_key.

    async function writeBufferToEnd(buf, offset, size) {

        const max_node_size = store.getNodeDataByteSizeLimit();

        const current_abs_position = ss.absolute_position;

        // -----
        // TODO: This section can be optimised. We don't need to traverse to
        //  -1 the current position because the branch nodes should inform us
        //  how full the previous leaf in the chain is.

        // Yes, get the left leaf and see if we add anything to it,
        const sc = StackState();
        // Populate from the main stack,
        sc.copyFrom( ss );
        // Traverse to the previous leaf on the new stack,
        await traverseToAbsolutePosition(
                    sc, sc.desired_key,
                    sc.absolute_position.sub( Int64.ONE ));

        // Is it possible to add anything to this leaf?
        const cur_leaf_size = sc.lastStackEntry().down_size;

        // -----

        // Is it worth adding to the leaf?
        const worth_adding_to_leaf = (
                cur_leaf_size + size <= max_node_size ||
                cur_leaf_size < ( ( max_node_size * 0.80 ) | 0 ) );

        if ( worth_adding_to_leaf ) {

            // Make 'sc' the main stack,
            ss.copyFrom( sc );

            // Ensure the stack and leaf are mutable,
            await ensureMutableStackAndLeaf();

            const se = ss.lastStackEntry();
            const leaf_end_p = se.down_size;
            const leaf_end_p_num = leaf_end_p.toInt();
            const remaining_leaf_capacity = max_node_size - leaf_end_p_num;
            const write_amount = Math.min( remaining_leaf_capacity, size );

            const leaf_node = await fetchNode(se.down_addr);
            leaf_node.copyFromBuffer( buf, offset, write_amount, leaf_end_p_num );

            offset += write_amount;
            size -= write_amount;

            // Adjust the 'down_size' values of the current stack,
            await stackAdjustDownSize( ss.getSize() - 1, write_amount );

            // Update 'absolute_end_position' since the data grew,
            if (ss.absolute_end_position.gte( Int64.ZERO ) ) {
                ss.absolute_end_position = ss.absolute_end_position.add(
                                        Int64.fromNumber( write_amount ) );
            }

            // Traverse past the data that was added to the existing leaf,
            await traverseToAbsolutePosition(
                        ss, ss.desired_key,
                        current_abs_position.add( Int64.fromNumber(write_amount) ));

        }

        // If there's data left to write, append as new leaf nodes,
        if (size > 0) {

            const change_position_amount = Int64.fromNumber( size );

            // Insert key,
            await ensureMutableStack();

            // Append leaf nodes at the current cursor as specified by the
            // main stack.
            await appendNodesForBuffer(
                        buf, offset, size,
                        max_node_size, change_position_amount );

            // Move forward position by the size we wrote,
            await traverseToAbsolutePosition(
                        ss, ss.desired_key,
                        ss.absolute_position.add( change_position_amount ) );

        }

    }



    // Reads data from the current position and writes it to the given buf.
    // Will write data until either 'size' number of bytes has been read or
    // the end of the data has been reached.
    async function copyToBuffer(buf, offset, size) {

        // Assert stack loaded,
        if ( ss.getSize() === 0 ) {
            throw Error("Stack not populated");
        }

        // Sanity checks,
        if ( size > ( buf.length - offset ) ) {
            throw Error("size to copy greater than buffer size");
        }
        if (size < 0) {
            throw Error("Negative size");
        }

        let total_read_count = 0;

        while (size > 0) {

            const last_abs_position = ss.absolute_position;

            const bytes_read = await readChunkToBuffer(buf, offset, 1, size);
            // If amount_read is not 1 or greater, it means the end of the
            // data has been reached, therefore return early.
            if (bytes_read <= 0) {
                break;
            }

            // Position cursor to the end of the consumed string,
            await traverseToAbsolutePosition(
                    ss, ss.desired_key,
                    last_abs_position.add(
                            Int64.fromNumber( bytes_read ) ) );

            // Update for next chunk of data,
            total_read_count += bytes_read;
            offset += bytes_read;
            size += bytes_read;

        }

        return total_read_count;

    }



    // Reads data from the buffer and writes out to the key value at the
    // current position.
    async function copyFromBuffer(buf, offset, size) {

        // Assert stack loaded,
        if ( ss.getSize() === 0 ) {
            throw Error("Stack not populated");
        }

        // Sanity checks,
        if ( size > ( buf.length - offset ) ) {
            throw Error("size to copy greater than buffer size");
        }
        if (size < 0) {
            throw Error("Negative size");
        }
        if (size === 0) {
            return;
        }

        const max_node_size = store.getNodeDataByteSizeLimit();
        const change_position_amount = Int64.fromNumber( size );

        // If the cursor didn't land on the key,
        if ( ss.desired_key.neq( ss.loaded_key ) ) {

            // Either we have to create a leaf(s) for the key, or raise an
            // error because the position is out of range,

            // In the case of key not being present and relative position being
            // in range, the positions should all be the same and positive.
            // If this is not the case then raise a position out of range
            // error.

            if ( ss.absolute_start_position.lt( Int64.ZERO ) ||
                 ss.absolute_end_position.lt( Int64.ZERO ) ||
                 ss.absolute_position.neq( ss.absolute_start_position ) ||
                 ss.absolute_position.neq( ss.absolute_end_position ) ) {

                debugDumpStackState(console.error);
                throw positionOutOfBoundsError();

            }

            // This is the case when there's no leaf data currently stored in
            // the tree for the desired_key. So we must create the leaf nodes
            // containing the input buf and insert them into the tree.

            // Insert key,
            await ensureMutableStack();

            // Append leaf nodes at the current cursor as specified by the
            // main stack.
            await appendNodesForBuffer(
                        buf, offset, size,
                        max_node_size, change_position_amount );

            // Move forward position by the size we wrote,
            await traverseToAbsolutePosition(
                        ss, ss.desired_key,
                        ss.absolute_position.add( change_position_amount ) );

        }

        // So we know there's existing data for the given key.
        //     ss.desired_key.eq( ss.loaded_key )
        //
        // If appending data to the end of the node,
        else if ( ss.lastStackEntry().right_key.neq( ss.desired_key ) ) {

            await writeBufferToEnd(buf, offset, size);

        }
        // Not adding data to the end of the leaf set, so determine how much
        // data we are overwriting of the current leaf nodes and how many
        // more nodes we have to add,
        else {

            // This loop overwrites existing data in the leaf nodes,
            while (size > 0) {

                // Ensure the stack and leaf are mutable,
                await ensureMutableStackAndLeaf();

                const se = ss.lastStackEntry();

                // The position in the leaf of the cursor,
                const int64_pos_in_leaf = ss.absolute_position.sub( se.left_offset );
                let pos_in_leaf = int64_pos_in_leaf.toInt();
                // The number of bytes left until the end of the current leaf node,
                let byte_to_leaf_end = se.down_size.sub( int64_pos_in_leaf ).toInt();

                // Fetch the leaf node data,
                const leaf_node_buf = await fetchNode( se.down_addr );

                // The amount to write,
                const write_amount = Math.min( byte_to_leaf_end, size );
                leaf_node_buf.copyFromBuffer( buf, offset, write_amount, pos_in_leaf );

                offset += write_amount;
                size -= write_amount;

                // Transition forward,
                await traverseToAbsolutePosition(
                            ss, ss.desired_key,
                            ss.absolute_position.add( write_amount ) );

                // If there's still data left to write to data node, and the
                // cursor is at the end,
                if ( size > 0 &&
                     ss.lastStackEntry().right_key.neq( ss.desired_key ) ) {

                    // Write the remaining part of the buffer to the end of
                    // the data chain,

                    await writeBufferToEnd(buf, offset, size);
                    break;

                }

            }  // while (size > 0)

        }

    }




    // Writes a string at the given position,

    async function writeString(str, encoding) {

        if (encoding === undefined) {
            encoding = DEFAULT_STRING_ENCODING;
        }

        // Create a Buffer, decode the string into the buffer. Large strings
        // are piped through a fixed size buffer.

        if (encoding === 'utf8') {

            const chunk_bytesize_limit = store.getNodeDataByteSizeLimit();
            let cp_offset = 0;
            let terminated = false;

            // Pipe the string through this buffer,
            const buf = Buffer.alloc( chunk_bytesize_limit );

            while (cp_offset < str.length && terminated === false) {

                const str_part = str.substring( cp_offset );
                const v = calculateUTF8CodePointSize( str_part, chunk_bytesize_limit );
                const cp_size = v.i;
                const bytesize = v.bytesize;
                terminated = v.zero_terminated;
                cp_offset += cp_size;

                if ( bytesize > 0 ) {

                    // Write the string section to the buffer,
                    const act_bytesize = buf.write(
                            str_part.substring( 0, cp_size ), 0, bytesize, 'utf8' );

                    // Assert,
                    if (act_bytesize !== bytesize) {
                        throw Error("UTF8 encoding error. Encoded byte size != calculated");
                    }

                    // Write this section of the encoded string.
                    // Note that 'buf' can not be greater in size than some
                    // specified maximum size for the writethrough buffer.
                    await copyFromBuffer( buf, 0, bytesize );

                }

            }

        }
        else {
            throw Error("Unsupported encoding");
        }

    }

    // Reads a string up to the given length (in utf16 codepoints). Moves the
    // pointer forward by the number of bytes read. Note that the length of
    // the returned string does not always correspond with the number of bytes
    // the cursor moved forward through this operation because of the UTF
    // encoding method.
    //
    // If a zero byte is reached, or the end of the data is reached, returns
    // the string up until that point. Will not return partially decoded UTF.
    // This means, this function will return either with the cursor at the end
    // of the data, or at a zero byte, or at the end of the last fully encoded
    // codepoint, or at the codepoint after 'length' codepoints have been read.
    //
    // If no length given, reads a string up to the maximum string size of
    // (1 << 28) - 16 which is about 256MB.

    async function readString(length, encoding) {

        // If 'readString(encoding)'
        if (typeof length === 'string') {
            encoding = length;
            length = MAX_READ_STRING_LENGTH;
        }
        // If 'readString()'
        else if (length === undefined) {
            length = MAX_READ_STRING_LENGTH;
        }

        if (encoding === undefined) {
            encoding = DEFAULT_STRING_ENCODING;
        }

//        debugDumpStackState( console.log );

        if ( ss.desired_key.neq( ss.loaded_key ) ) {
            throw new Error("Position out of range");
        }

        if (encoding === 'utf8') {

            let out_str = '';
            let remaining_length = length;

            const MIN_READ_SIZE = 16;
            const MAX_READ_BUF_SIZE = 4096;

            // The buffer to pipe all string reads through,
            const read_buf = Buffer.alloc( MAX_READ_BUF_SIZE );

            let end_reached = false;
            while (end_reached === false) {

                const last_abs_position = ss.absolute_position;

                // Reads a chunk of data into the buffer using a minimum amount
                // node store requests.
                const bytes_read = await readChunkToBuffer( read_buf, 0,
                                            MIN_READ_SIZE, MAX_READ_BUF_SIZE );

                // If we read bytes,
                if (bytes_read > 0) {

                    // Decode UTF8 string from buffer data,
                    const v = readUTF8StringFromBuffer(
                                read_buf, 0, bytes_read, remaining_length );

                    // Returns:
                    //  v.str_part : The string consumed from buffer.
                    //  v.bytesize : Number of bytes in buffer consumed.
                    //  v.zero_terminated : True if 0x0 terminator reached.

                    remaining_length -= v.str_part.length;

                    // Position cursor to the end of the consumed string,
                    await traverseToAbsolutePosition(
                            ss, ss.desired_key,
                            last_abs_position.add(
                                    Int64.fromNumber( v.bytesize ) ) );

                    // Append string part,
                    out_str += v.str_part;

                    // Loop terminating conditions,
                    end_reached = remaining_length <= 0 ||
                                  v.zero_terminated === true ||
                                  v.bytesize === 0;

                }

                // If no bytes read, then the string is terminated because end
                // of data is reached.
                else {
                    end_reached = true;
                }

            }

            // Return the completed string,
            return out_str;

        }
        else {
            throw Error("Unsupported encoding");
        }



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
            const branch_node_data = await fetchNode(addr);
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
            const child_size = branch_node_data.readInt64(n + 16);
            const key = branch_node_data.readAddr(n + 24);
            out += child_addr.asString();
            out += ' ';
            out += child_size;
            out += ' ';
            out += key.asString();
            out += ' ';
        }
        const child_addr = branch_node_data.readAddr(n);
        const child_size = branch_node_data.readInt64(n + 16);
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


    function debugDumpStackState(println, stack = ss) {
        println( stack.asString() );
    }



    async function recurseIntegrityCheck(addr) {

        if ( isBranchNodeAddr(addr) ) {

            const node_buf = await fetchNode(addr);
            const size = node_buf.getSize();

            let this_computed_bytesize = Int64.ZERO;

            for (let i = 0; i < size; i += 40) {

                const child_addr = node_buf.readAddr(i);
                const recorded_bytesize = node_buf.readInt64(i + 16);

                const checked_child_bytesize = await recurseIntegrityCheck(child_addr);

                if (recorded_bytesize.neq( checked_child_bytesize ) ) {
                    throw Error("Integrity failed: branch size does not equal computed size.");
                }

                this_computed_bytesize = this_computed_bytesize.add( recorded_bytesize );

            }

            return this_computed_bytesize;

        }
        else {

            const node_buf = await fetchNode(addr);
            return Int64.fromNumber( node_buf.getSize() );

        }

    }


    async function debugCheckTreeIntegrity() {
        const addr = root_addr;
        return await recurseIntegrityCheck(addr);
    }





    // Locking feature to help prevent asynchronous access to the stack state.

    /* async */ function lock() {
        if (locked === true) {
            throw Error('Multiple locks on TreeStack. Synchronous access is required.');
        }
        locked = true;
    }

    /* async */ function unlock() {
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

        lock,           // async
        unlock,         // async

        invalidate,

        setupStackForRelativePosition,
        getRelativePosition,

//        stackLoadToEndOfKey,          // async

//        stackLoadToKeyPosition,       // async


        writeString,     // async
        readString,      // async

//        readUInt8,       // async
//        writeUInt8,      // async
        copyToBuffer,    // async
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
