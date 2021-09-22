"use strict";

// Integer hash map with linked list for key/value pairs on hash collisions.

function HashMap(keyHash, keyEquals, max_array_size = 23173) {

    const jsmap = [];

    function ll( key, value, next ) {
        return {
            key,
            value,
            next
        };
    }

    function calcKeyHash( key ) {
        return keyHash( key ) % max_array_size;
    }

    function get( key ) {
        const hash = calcKeyHash( key );
        const f = jsmap[hash];
        if (f !== undefined) {
            let l = f;
            do {
                if ( keyEquals( l.key, key ) ) {
                    return l.value;
                }
                l = l.next;
            } while ( l !== undefined );
        }
        return undefined;
    }

    function set( key, value ) {
        const hash = calcKeyHash( key );
        const f = jsmap[hash];
        if ( f !== undefined ) {
            let l = f;
            do {
                if ( keyEquals( l.key, key ) ) {
                    const prev_val = l.value;
                    l.value = value;
                    return prev_val;
                }
                l = l.next;
            } while ( l !== undefined );
        }
        jsmap[hash] = ll( key, value, f );
        return undefined;
    }

    function remove( key ) {
        const hash = calcKeyHash( key );
        const f = jsmap[hash];
        if ( f !== undefined ) {
            let p;
            let l = f;
            do {
                if ( keyEquals( l.key, key ) ) {
                    if (p === undefined) {
                        jsmap[hash] = l.next;
                    }
                    else {
                        p.next = l.next;
                    }
                    return l.value;
                }
                p = l;
                l = l.next;
            } while ( l !== undefined );
        }
        return undefined;
    }

    function dump(println) {
        println( JSON.stringify( jsmap, null, 2 ) );
    }

    return {
        get,
        set,
        remove,
        dump
    };

}

module.exports = HashMap;
