"use strict";

/* global BigInt */

function AsyncValue(fetchOperation) {

    const waiting = [];
    let value;

    // Perform the fetch operation,

    async function doFetch() {

        let waiting_copy;

        try {

            try {

                value = await fetchOperation();
                if (value === undefined) {
                    throw Error("fetch returned undefined value");
                }

            }
            finally {
                // Copy array and clear existing,
                waiting_copy = [...waiting];
                waiting.length = 0;
            }

            // Send out responses to any promises waiting,
            for (const p of waiting_copy) {
                p.resolve(value);
            }

        }
        catch (err) {

            // Send out rejections to any promises that are waiting,
            for (const p of waiting_copy) {
                p.reject(err);
            }

        }

    }


    // Either returns the value, or a Promise that resolves the value
    // asynchronously,
    function get() {

        // If value resolved already, return it now.
        if (value !== undefined) {
            return value;
        }

        // Otherwise return a promise to fetch it asynchronously,
        return new Promise( (resolve, reject) => {

            // If the value is fetched, return it immediately,
            if (value !== undefined) {
                return resolve(value);
            }
            // Otherwise push the promise callbacks to waiting set,
            waiting.push({ resolve, reject });
            // If this is the first waiting value,
            if (waiting.length === 1) {
                // Go perform the fetch asynchronously,
                doFetch();
            }

        } );

    }

    return {
        get
    };

}


// 64-bit precision BigInt,
function BigInt64(v) {
    return BigInt.asIntN( 64, BigInt( v ) );
}




module.exports = {
    AsyncValue,
    BigInt64
};
