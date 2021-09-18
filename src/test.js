"use strict";

const seedrandom = require('seedrandom');

const HeapStore = require('./store/heapstore.js');
const HeapRootChain = require('./store/heaprootchain.js');

const TreeBootstrap = require('./tree/bootstrap.js');

const KVDatabase = require('./database/kvdatabase.js');

const { Addr } = require('./store/Addr.js');
const { Key, KeyStatics } = require('./tree/key.js');

const Int64 = require('./util/int64.js');





const KEY_HIGH_INT64 =  Int64.fromString('00f2000000000000', true, 16);
const KEY_LOW_INT64_B = Int64.fromString('0abcd0', true, 16);



async function insert1(db) {

    // Start Transaction,
    const tx = db.tx();

    const string_types = [
        'zoopnarnoindico ',
        'malnoquinsicbarnoc ',
        'id5 ',
        'kibbler'
    ];


    try {

        let size_added = Int64.ZERO;
        let data_size;

        for (let i = 0; i < 70; ++i) {

            const acti = i * 2;

            // Key in the database,
            const key = Key( KEY_HIGH_INT64, KEY_LOW_INT64_B.add( acti ) );
            data_size = 1024;

            const data = tx.getDataValue(key);
            const buf = Buffer.alloc( data_size, string_types[ i % 4 ] );
            await data.copyFromBuffer(buf, 0, data_size);

            size_added = size_added.add( data_size );

        }

        // Key in the database,
        const key02 = Key('00f200000000000000000000000abcd7');
        data_size = 12800;

        const data02 = tx.getDataValue(key02);
        const buf02 = Buffer.alloc(data_size, 'belfordian ');
        await data02.copyFromBuffer(buf02, 0, data_size);

        size_added = size_added.add( data_size );



        const total_size = await tx.debugCheckTreeIntegrity();
        console.log("+ Tree Total Size = ", total_size);
        console.log("Total Data Size = ", size_added);



        // Commit the change,
        await tx.commit();

    }
    // Ensure the transaction is closed,
    finally {
        tx.close();
    }

}


async function insert2(db) {

    // Start Transaction,
    const tx = db.tx();

    try {

        // Key in the database,
        const key01 = Key('00f200000000000000000000000abcd3');
        let data_size = 600;

        const data01 = tx.getDataValue(key01);
        const buf01 = Buffer.alloc(data_size, 'teribonian ');
        await data01.copyFromBuffer(buf01, 0, data_size);

        const key02 = Key('00f200000000000000000000000abcd9');
        data_size = 453600;

        const data02 = tx.getDataValue(key02);
        const buf02 = Buffer.alloc(data_size, 'zoofoundland-');
        await data02.copyFromBuffer(buf02, 0, data_size);





        const total_size = await tx.debugCheckTreeIntegrity();
        console.log("+ Tree Total Size = ", total_size);

        await tx.debugDumpTreeBranches(console.log);

        // Commit the change,
        await tx.commit();

    }
    // Ensure the transaction is closed,
    finally {
        tx.close();
    }

}



async function dumpTXInfo(db) {

    // Start Transaction,
    const tx = db.tx();

    try {

        const total_size = await tx.debugCheckTreeIntegrity();
        console.log("+ Tree Total Size = ", total_size);

        await tx.debugDumpTreeBranches(console.log);

    }
    // Ensure the transaction is closed,
    finally {
        tx.close();
    }

}





function makeRNGString(rng, length) {
    let result           = '';
    const characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for ( let i = 0; i < length; i++ ) {
        result += characters.charAt(Math.floor(rng() * charactersLength));
    }
    return result;
}

// Insert test key data into database,

async function insertTestData(db, test_data) {

    // Start Transaction,
    const tx = db.tx();

    try {

        for (const keyv in test_data) {

            const key_data = test_data[keyv];

            const key = Key( KEY_HIGH_INT64, Int64.fromNumber( keyv ) );
            const data = tx.getDataValue(key);

            data.setPosition( Int64.fromNumber( 0 ) );
            await data.writeString(key_data);

        }

        // const total_size = await tx.debugCheckTreeIntegrity();
        // console.log("+ Tree Total Size = ", total_size);
        //
        // await tx.debugDumpTreeBranches(console.log);

        // Commit the change,
        await tx.commit();

    }
    // Ensure the transaction is closed,
    finally {
        tx.close();
    }

}

// Check if the written data is the same as the data stored in the database,

async function checkTestData(db, test_data) {

    // Start Transaction,
    const tx = db.tx();

    try {

        for (const keyv in test_data) {

            const key_data = test_data[keyv];

            const key = Key( KEY_HIGH_INT64, Int64.fromNumber( keyv ) );
            const data = tx.getDataValue(key);

            // Position on start of data value,
            data.start();
//            data.setPosition( Int64.fromNumber( -(1 + 8192 + 8192 + 3159 + 0) ) );
            const read_key_data = await data.readString();

            if (key_data !== read_key_data) {
                console.error({
                    key_data,
                    read_key_data,
                    key_data_length: key_data.length,
                    read_key_data_length: read_key_data.length,
                    key
                });
                throw Error("Data check failed!");
            }
            console.log("CHECK PASSED FOR: ", key);

        }

    }
    // Ensure the transaction is closed,
    finally {
        tx.close();
    }

}




function createTestData() {

    const rng = new seedrandom('09GRubness22');

    const data = {};
    for (let s = 0; s < 10; ++s) {
        const keyn = ( rng() * 1000 ) | 0;
        data[keyn] = makeRNGString( rng, ((rng() * rng() * rng() * 100000) + 50) | 0 );
    }

    return data;

}





async function run2() {

    const store = HeapStore();
    const rootchain = HeapRootChain();

    // Initialise an empty database on the root chain,
    await TreeBootstrap.createEmpty(store, rootchain);

    // New key/value database,
    const db = KVDatabase(store, rootchain);

//    await insert1(db);
//    await insert2(db);

    const test_data = createTestData();

    await insertTestData(db, test_data);
    await dumpTXInfo(db);
    await checkTestData(db, test_data);


}










async function run1() {


    const store = HeapStore();

    const databuffer = store.createEmptyDataBuffer();

    databuffer.writeInt32(       500,  0 );
    databuffer.writeInt32(      1500,  4 );
    databuffer.writeInt32(         2,  8 );
    databuffer.writeBigInt(    -543n, 12 );
    databuffer.writeDouble(  2.12432e-6, 32 );

    console.log( "#" + databuffer.getAddr().asString() + " =" );
    console.log( databuffer.asString() );
    console.log( "  size =", databuffer.getSize() );
    console.log( " limit =", databuffer.getLimit() );
    console.log("---");



    const addr_set = await store.writeAll( [ databuffer ] );
    const dataspan = await store.get( addr_set[0] );

    console.log( "#" + dataspan.getAddr().asString() + " =" );
    console.log( dataspan.asString() );
    console.log( "  size =", dataspan.getSize() );
    console.log( " limit =", dataspan.getLimit() );
    console.log("---");

    console.log( dataspan.readInt32( 0 ) );
    console.log( dataspan.readInt32( 4 ) );
    console.log( dataspan.readInt32( 8 ) );
    console.log( dataspan.readBigInt( 12 ) );
    console.log( dataspan.readDouble( 32 ) );


    console.log("---");

    let dbuf2 = store.createEmptyDataBuffer();

    const test_addr = Addr( 0x06100000000000000n, 0x01234n );

    dbuf2.writeInt32(       2,   0 );
    dbuf2.writeAddr( test_addr,  4 );
    dbuf2.writeInt32(       4,  20 );
    dbuf2.writeInt32(       6,  24 );
    dbuf2.writeInt32(       9,  28 );

    console.log(dbuf2.asString());
    console.log( dbuf2.diag() );

    console.log("WRITE 1:");
    const addr_set2 = await store.writeAll( [ dbuf2 ] );
    dbuf2 = store.convertSpanToBuffer( await store.get( addr_set2[0] ) );

    // Shift and write,
    dbuf2.shift(   2,  4 );
    dbuf2.shift(   2, 22 );
    dbuf2.shift( -20, 24 );
    dbuf2.shift(   4,  4 );

    console.log( dbuf2.asString() );
    console.log( dbuf2.diag() );

//    dbuf2.setSize(4);
    dbuf2.setSize(512);

    console.log("WRITE 2:");
    const addr_set3 = await store.writeAll( [ dbuf2 ] );
    dbuf2 = store.convertSpanToBuffer( await store.get( addr_set3[0] ) );

    console.log( dbuf2.asString() );
    console.log( dbuf2.diag() );



    console.log("Far Left Key:  ", KeyStatics.FAR_LEFT_KEY.asString());
    console.log("Far Right Key: ", KeyStatics.FAR_RIGHT_KEY.asString());

    console.log("RIGHT > LEFT = ",
                KeyStatics.FAR_RIGHT_KEY.compareTo( KeyStatics.FAR_LEFT_KEY ) );


}

run2();
