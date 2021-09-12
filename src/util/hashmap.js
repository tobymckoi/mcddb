"use strict";

// Integer hash map with linked list for key/value pairs on hash collisions.

function HashMap(keyHash, keyEquals) {

    const jsmap = [];

    function ll( key, value, next ) {
        return {
            key,
            value,
            next
        };
    }

    function get( key ) {
        const hash = keyHash( key );
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
        const hash = keyHash( key );
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
        const hash = keyHash( key );
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

    return {
        get,
        set,
        remove
    };

}

module.exports = HashMap;
