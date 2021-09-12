"use strict";

function run() {

    const buf = Buffer.alloc(100, 0);

    console.log(buf.toString('hex'));

    console.log(buf.readDoubleBE(0));
    console.log(buf.readFloatBE(0));

}

run();
