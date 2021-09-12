"use strict";

const { createSparseLeafAddr } = require('../store/addr.js');
const { KeyStatics } = require('./key.js');
const Int64 = require('../util/int64.js');

// Creates an empty tree on the given rootchain. Fails if the root chain is
// not empty.

async function createEmpty(store, rootchain) {

    // One byte sparse leaf store address,
    const one_byte_sparse_leaf_addr = createSparseLeafAddr( Int64.ONE );

    // Construct data buffer representing an empty tree.
    // An empty tree is a branch node with 2 virtual sparse leaf nodes of size
    // 1 representing the far left and right keys.
    const BRANCH = true;
    const empty_root_branch_node_buf = store.createEmptyDataBuffer(BRANCH);
    let n = 0;
    empty_root_branch_node_buf.writeAddr( one_byte_sparse_leaf_addr, n );
    n += 16;
    empty_root_branch_node_buf.writeInt64( Int64.ONE, n );
    n += 8;
    empty_root_branch_node_buf.writeValue128( KeyStatics.FAR_LEFT_KEY, n );
    n += 16;
    empty_root_branch_node_buf.writeAddr( one_byte_sparse_leaf_addr, n );
    n += 16;
    empty_root_branch_node_buf.writeInt64( Int64.ONE, n );
    n += 8;

    const out_addrs = await store.writeAll([ empty_root_branch_node_buf ]);

//    const root_addr = PROC_EMPTY_TREE_ADDR;
    // This fails if top entry in chain is not 'undefined'
    await rootchain.putEntry(out_addrs[0], undefined);

}

// Exports,
module.exports = {
    createEmpty
};
