"use strict";

const { Key } = require("./tree/key.js");



function run() {

    // Strings example,
    const key1 = Key('0a0000000000000000000000000000ab');
    const key2 = Key('0a50ffff');
    const key3 = Key('0a0000000000000000000000000000abffffffff');
    const key4 = Key('0a0000000000000000000000ba');


    const mock_node = Buffer.alloc(16384);

    mock_node.writeBigInt64BE( 854553534344324n, 0 );
    mock_node.writeBigInt64BE( -14553453433n, 8 );

    // Buffer example,,
    const key5 = Key( mock_node.slice(  0,  0 + 16 ) );
    const key6 = Key( mock_node.slice( 76, 76 + 16 ) );

    // BigInt example,
    const key7 = Key( 0x07FF0000000000000n, 0x0EEn );


    const key8  = Key( 0x0400000n, 0x0101n );
    const key9  = Key( 0x0400000n, 0x0102n );
    const key10 = Key( 0x0400000n, 0x0100n );


    console.log( key1.asString() );
    console.log( key2.asString() );
    console.log( key3.asString() );
    console.log( key4.asString() );

    console.log("---");

    console.log( key5.asString() );
    console.log( key6.asString() );

    console.log("---");

    mock_node.writeBigInt64BE( 122222222222222n, 76 + 0 );
    mock_node.writeBigInt64BE( -12222225343n,    76 + 8 );

    console.log( key5.asString() );
    console.log( key6.asString() );

    console.log("---");

    console.log( key7.asString() );

    console.log("---");

    console.log( key1.isEqual(key1) );
    console.log( key1.isEqual(key2) );
    console.log( key1.isEqual(key3) );


    console.log( key1.compareTo(key1) );
    console.log( key1.compareTo(key2) );
    console.log( key1.compareTo(key3) );

    console.log( key2.compareTo(key1) );

    console.log( key8.compareTo(key9) );
    console.log( key8.compareTo(key10) );
    console.log( key10.compareTo(key9) );

    console.log("----");

    console.log( key1.hashCode() );
    console.log( key2.hashCode() );
    console.log( key3.hashCode() );
    console.log( key4.hashCode() );
    console.log( key5.hashCode() );
    console.log( key6.hashCode() );
    console.log( key7.hashCode() );
    console.log( key8.hashCode() );
    console.log( key9.hashCode() );
    console.log( key10.hashCode() );



    const HASH_SIZE = 25;

    console.log("----");
    console.log( Key('0000ab').hashCode() % HASH_SIZE );
    console.log( Key('0000ac').hashCode() % HASH_SIZE );
    console.log( Key('0000ad').hashCode() % HASH_SIZE );
    console.log( Key('0000ae').hashCode() % HASH_SIZE );
    console.log( Key('0000af').hashCode() % HASH_SIZE );
    console.log( Key('0000b0').hashCode() % HASH_SIZE );
    console.log( Key('0000b1').hashCode() % HASH_SIZE );
    console.log( Key('0000b2').hashCode() % HASH_SIZE );
    console.log( Key('0000b3').hashCode() % HASH_SIZE );
    console.log( Key('0000b4').hashCode() % HASH_SIZE );
    console.log( Key('0000b5').hashCode() % HASH_SIZE );
    console.log( Key('0000b6').hashCode() % HASH_SIZE );
    console.log( Key('0000b7').hashCode() % HASH_SIZE );
    console.log( Key('0000b8').hashCode() % HASH_SIZE );
    console.log( Key('0000b9').hashCode() % HASH_SIZE );
    console.log( Key('0000ba').hashCode() % HASH_SIZE );
    console.log( Key('0000bb').hashCode() % HASH_SIZE );


    // const EVILCODE = {
    //     isBufferEqual: (buf) => {
    //         console.log("OOPS, Exposed: " + buf);
    //     }
    // };
    // console.log( key1.isEqual(EVILCODE) );



    // class ClassWithPublicInstanceMethod {
    //     #privatef = 30;
    //     publicMethod() {
    //         return 'hello world ' + this.#privatef;
    //     }
    //     fetchFrom(n) {
    //         return n.#privatef;
    //     }
    // }
    //
    // const instance1 = new ClassWithPublicInstanceMethod();
    // const instance2 = new ClassWithPublicInstanceMethod();
    // console.log(instance1.publicMethod());
    //
    // console.log(instance2.publicMethod());
    // console.log(instance2.fetchFrom(instance1));


}

run();
