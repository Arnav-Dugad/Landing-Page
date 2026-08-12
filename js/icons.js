/* ===========================================================================
   icons.js  (classic script)
   A hand-drawn 24px stroke icon set, inlined as SVG.

   Why not an icon font: webfont icons flash, can't be tinted per-path, and
   pull a ~100kB CDN request onto the critical path. These ship with the HTML
   and inherit `currentColor`.

   Projects already in Firestore store FontAwesome names ("fa-rocket"), so
   LEGACY maps those onto the new keys — no data migration needed.
   =========================================================================== */

(() => {
    /* Every entry is the *inside* of a 24x24 viewBox. Stroke, never fill,
       except where a solid mark reads better (star-fill). */
    const P = {
        /* -- project marks ------------------------------------------------ */
        rocket:   '<path d="M12 2.5c3.4 2.2 5.2 5.6 5.2 9.4 0 2-.5 3.8-1.4 5.3H8.2c-.9-1.5-1.4-3.3-1.4-5.3 0-3.8 1.8-7.2 5.2-9.4Z"/><circle cx="12" cy="10" r="2.1"/><path d="M8.4 17.2c-1.6 1-2.3 2.6-2.3 5 2-.4 3.4-1.2 4.3-2.5M15.6 17.2c1.6 1 2.3 2.6 2.3 5-2-.4-3.4-1.2-4.3-2.5"/>',
        gamepad:  '<rect x="2.5" y="7" width="19" height="10.5" rx="4.5"/><path d="M7 10.5v3.5M5.25 12.25h3.5M15.5 11.3h.01M18 13.5h.01"/>',
        dice:     '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>',
        puzzle:   '<path d="M10 3.5h4v2.2a1.8 1.8 0 1 0 3.6 0V3.5h2.9v4.4h-2.2a1.8 1.8 0 1 0 0 3.6h2.2v9h-9v-2.2a1.8 1.8 0 1 0-3.6 0v2.2h-4.4v-9h2.2a1.8 1.8 0 1 0 0-3.6H3.5V3.5H10Z"/>',
        ball:     '<circle cx="12" cy="12" r="9"/><path d="m12 7 4.3 3.1-1.7 5.1H9.4l-1.7-5.1L12 7Z"/><path d="M12 3v4M4.4 9.4 7.7 10M19.6 9.4 16.3 10M8.5 20.4l1-5.2M15.5 20.4l-1-5.2"/>',
        target:   '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>',
        mobile:   '<rect x="6.5" y="2.5" width="11" height="19" rx="3"/><path d="M10.5 18.5h3"/>',
        desktop:  '<rect x="2.5" y="3.5" width="19" height="13" rx="2.5"/><path d="M8 20.5h8M12 16.5v4"/>',
        robot:    '<rect x="3.5" y="8" width="17" height="12" rx="4"/><path d="M12 4.5V8M12 3.2h.01"/><path d="M8.8 13h.01M15.2 13h.01M9.5 16.6h5"/>',
        brain:    '<path d="M12 4.2a3 3 0 0 0-5.6 1.3A3.1 3.1 0 0 0 4.6 11a3.1 3.1 0 0 0 1.5 4.9A3 3 0 0 0 12 19.4Z"/><path d="M12 4.2a3 3 0 0 1 5.6 1.3A3.1 3.1 0 0 1 19.4 11a3.1 3.1 0 0 1-1.5 4.9A3 3 0 0 1 12 19.4Z"/><path d="M12 4.2v15.2"/>',
        chip:     '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5v3.5M14 3.5v3.5M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
        atom:     '<circle cx="12" cy="12" r="1.6"/><ellipse cx="12" cy="12" rx="9.5" ry="4" /><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="4" transform="rotate(120 12 12)"/>',
        code:     '<path d="m8.5 8-5 4 5 4M15.5 8l5 4-5 4M13.8 4.5l-3.6 15"/>',
        terminal: '<rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="m7 10 2.5 2L7 14M12.5 15h4.5"/>',
        flow:     '<rect x="3" y="3.5" width="6.5" height="5.5" rx="1.8"/><rect x="14.5" y="15" width="6.5" height="5.5" rx="1.8"/><path d="M6.25 9v5.5a3 3 0 0 0 3 3h5.25"/>',
        network:  '<rect x="9" y="2.5" width="6" height="5" rx="1.6"/><rect x="2" y="16.5" width="6" height="5" rx="1.6"/><rect x="16" y="16.5" width="6" height="5" rx="1.6"/><path d="M12 7.5v4.2M5 16.5v-2.3a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5v2.3"/>',
        server:   '<rect x="2.5" y="3.5" width="19" height="7" rx="2.5"/><rect x="2.5" y="13.5" width="19" height="7" rx="2.5"/><path d="M6.5 7h.01M6.5 17h.01M10.5 7h4M10.5 17h4"/>',
        database: '<ellipse cx="12" cy="5.8" rx="8" ry="3.3"/><path d="M4 5.8v12.4c0 1.8 3.6 3.3 8 3.3s8-1.5 8-3.3V5.8"/><path d="M20 12c0 1.8-3.6 3.3-8 3.3s-8-1.5-8-3.3"/>',
        globe:    '<circle cx="12" cy="12" r="9"/><path d="M3.2 9.5h17.6M3.2 14.5h17.6"/><ellipse cx="12" cy="12" rx="4" ry="9"/>',
        cloud:    '<path d="M7 18.5a4.5 4.5 0 0 1-.5-8.97 5.5 5.5 0 0 1 10.55-1.4A4.25 4.25 0 0 1 17.5 18.5Z"/>',
        bolt:     '<path d="M13.2 2.5 5 13.4h5.6l-.8 8.1L18.8 10.6h-5.6l.8-8.1Z"/>',
        flame:    '<path d="M12 21.5c3.6 0 6.2-2.4 6.2-5.7 0-4.4-4.2-5.9-3.4-11.3-2.8 1-4.5 3-4.5 5.6 0 1.3-.7 1.9-1.4 1.9s-1.3-.6-1.4-1.7C6.4 12 5.8 13.8 5.8 15.8c0 3.3 2.6 5.7 6.2 5.7Z"/>',
        'chart-line': '<path d="M3.5 3.5v14a3 3 0 0 0 3 3h14"/><path d="m7.5 15.5 3.6-4.2 3 2.6 4.9-6"/>',
        'chart-pie':  '<path d="M12 3.2a8.8 8.8 0 1 0 8.8 8.8H12Z"/><path d="M15.5 2.2A8.8 8.8 0 0 1 21.8 8.5h-6.3Z"/>',
        'chart-bar':  '<path d="M3.5 20.5h17"/><rect x="5.5" y="11" width="3.6" height="6.5" rx="1.2"/><rect x="10.2" y="6.5" width="3.6" height="11" rx="1.2"/><rect x="14.9" y="13.5" width="3.6" height="4" rx="1.2"/>',
        table:    '<rect x="3" y="4" width="18" height="16" rx="2.8"/><path d="M3 9.5h18M9.5 9.5V20M3 15h18"/>',
        checklist:'<path d="m3.5 6.5 1.8 1.8 3-3.2M3.5 15l1.8 1.8 3-3.2M11.5 7h9M11.5 16h9"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 2.8v4M16 2.8v4M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
        clock:    '<circle cx="12" cy="12" r="9"/><path d="M12 6.6V12l3.6 2.2"/>',
        wallet:   '<path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h11.5a2 2 0 0 1 2 2v1"/><rect x="3.5" y="7.5" width="17" height="12" rx="3"/><path d="M20.5 12h-3.7a1.9 1.9 0 0 0 0 3.8h3.7"/>',
        cart:     '<path d="M2.5 3.5h2.2l2.5 11.2h10l2.3-8.2H6"/><circle cx="9" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
        map:      '<path d="m3 6.5 6-2.8 6 2.8 6-2.8v14.6l-6 2.8-6-2.8-6 2.8Z"/><path d="M9 3.7v14.6M15 6.5v14.6"/>',
        plane:    '<path d="M3 13.5 21 6.2 15.3 20l-3-6.1L3 13.5Z"/><path d="m12.3 13.9 4-4.8"/>',
        car:      '<path d="M4 15.5v3a1 1 0 0 1-1 1H2.5v-6.6l2-5A2.5 2.5 0 0 1 6.9 6h10.2a2.5 2.5 0 0 1 2.4 1.9l2 5v6.6H21a1 1 0 0 1-1-1v-3Z"/><path d="M2.5 12.9h19M7 16.2h.01M17 16.2h.01"/>',
        camera:   '<path d="M4.5 7.5h2.8l1.5-2.4h6.4l1.5 2.4h2.8a2 2 0 0 1 2 2v8.4a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13.4" r="3.6"/>',
        image:    '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.6" cy="9.4" r="1.8"/><path d="m3.6 17.5 4.9-4.4a2 2 0 0 1 2.7 0l6.4 5.8"/>',
        video:    '<rect x="2.5" y="5.5" width="13" height="13" rx="3"/><path d="m15.5 10.5 6-3.4v9.8l-6-3.4Z"/>',
        film:     '<rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="M7 4v16M17 4v16M2.5 12h19M2.5 8h4.5M2.5 16h4.5M17 8h4.5M17 16h4.5"/>',
        music:    '<path d="M8.5 18V5.6l11-2.1V16"/><circle cx="5.8" cy="18" r="2.7"/><circle cx="16.8" cy="16" r="2.7"/>',
        chat:     '<path d="M20.5 12.8c0 4-3.8 7.2-8.5 7.2a10 10 0 0 1-2.8-.4L3.5 21.2l1.4-4a6.9 6.9 0 0 1-1.4-4.2c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2Z"/><path d="M8.6 12.8h.01M12 12.8h.01M15.4 12.8h.01"/>',
        mail:     '<rect x="2.5" y="4.5" width="19" height="15" rx="3"/><path d="m3.5 7.5 7.3 5.2a2 2 0 0 0 2.4 0l7.3-5.2"/>',
        book:     '<path d="M4 4.2A2 2 0 0 1 6 2.5h13.5v15.6H6A2 2 0 0 0 4 20.1Z"/><path d="M4 20.1a2 2 0 0 0 2 1.4h13.5v-3.4"/>',
        cap:      '<path d="m2.5 8.7 9.5-4.2 9.5 4.2-9.5 4.2Z"/><path d="M6.8 10.6v5a5.6 5.6 0 0 0 10.4 0v-5M21 9.4v5.4"/>',
        shield:   '<path d="M12 2.7 4.5 5.9v5.6c0 4.6 3.1 8.4 7.5 9.8 4.4-1.4 7.5-5.2 7.5-9.8V5.9Z"/><path d="m8.8 11.9 2.2 2.2 4.2-4.4"/>',
        lock:     '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M7.8 10V7.6a4.2 4.2 0 0 1 8.4 0V10M12 14.4v2.6"/>',
        unlock:   '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M7.8 10V7.6a4.2 4.2 0 0 1 8.2-1.3M12 14.4v2.6"/>',
        sparkles: '<path d="M12 2.8 13.9 9l6.2 1.9-6.2 1.9L12 19l-1.9-6.2L3.9 10.9 10.1 9Z"/><path d="M18.6 3v3.2M20.2 4.6H17M5.4 16v2.6M6.7 17.3H4.1"/>',
        palette:  '<path d="M12 21c-5 0-9-3.9-9-8.8C3 7 7.3 3 12.6 3c4.6 0 8.4 3 8.4 6.9 0 2.5-2 4.4-4.6 4.4h-2a1.7 1.7 0 0 0-1.2 2.9c.4.4.6.9.6 1.4 0 1.3-1 2.4-1.8 2.4Z"/><path d="M7.4 12.2h.01M8.9 8.3h.01M13 6.8h.01M16.8 9h.01"/>',
        ruler:    '<path d="m3.5 15.6 8.3-8.3a1.5 1.5 0 0 1 2.1 0l2.8 2.8a1.5 1.5 0 0 1 0 2.1l-8.3 8.3Z"/><path d="m7 12.1 1.8 1.8M9.8 9.3l1.8 1.8M12.6 6.5l1.8 1.8"/><path d="M14.6 4.5 19.5 9.4l1.9-1.9a1.6 1.6 0 0 0 0-2.3l-2.6-2.6a1.6 1.6 0 0 0-2.3 0Z"/>',
        compass:  '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2 5.2-5.2 2 2-5.2Z"/>',
        heart:    '<path d="M12 20.4 4.6 13a4.7 4.7 0 0 1 6.6-6.7l.8.8.8-.8A4.7 4.7 0 0 1 19.4 13Z"/>',
        dumbbell: '<path d="M6.5 9v6M17.5 9v6M3.5 10.5v3M20.5 10.5v3M6.5 12h11"/>',
        utensils: '<path d="M6 2.8v7a2.5 2.5 0 0 0 5 0v-7M8.5 11.8v9.4M17.5 2.8c-1.6 1.3-2.4 3.3-2.4 6.1 0 1.9.8 3 2.4 3.2v9.1"/>',
        flask:    '<path d="M9.5 2.8h5M10.5 2.8v6L5.2 18.3a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3L13.5 8.8v-6"/><path d="M7.9 14.5h8.2"/>',
        layers:   '<path d="m12 2.8 9 4.7-9 4.7-9-4.7Z"/><path d="m3 12.4 9 4.7 9-4.7M3 16.9l9 4.7 9-4.7"/>',
        cubes:    '<path d="m12 2.5 5 2.8v5.4l-5 2.8-5-2.8V5.3Z"/><path d="M7 10.7v5.4l-5-2.8V7.9M17 10.7v5.4l5-2.8V7.9M12 13.5v6.4l-5 2.1M12 19.9l5 2.1"/>',
        gear:     '<circle cx="12" cy="12" r="3.2"/><path d="M19.6 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a1.9 1.9 0 1 1 0-3.8h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 2.7-1.1v-.3a1.9 1.9 0 1 1 3.8 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.4 1.1Z"/>',
        link:     '<path d="M10 13.6a4 4 0 0 0 6 .4l2.4-2.4a4 4 0 0 0-5.6-5.6l-1.4 1.3"/><path d="M14 10.4a4 4 0 0 0-6-.4l-2.4 2.4a4 4 0 0 0 5.6 5.6l1.4-1.3"/>',
        keyboard: '<rect x="2" y="6" width="20" height="12" rx="3"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.6h.01M9.5 13.6h5M18 13.6h.01"/>',
        cube:     '<path d="M12 2.5 20.5 7v10L12 21.5 3.5 17V7Z"/><path d="M3.7 7 12 11.8 20.3 7M12 21.5V11.8"/>',
        leaf:     '<path d="M20.5 3.5C9.5 3.5 4 8 4 15.5c0 2 .6 3.6 1.5 5C7 17 10.6 13.8 16 12c-4 2.6-6.9 5.8-8.5 9.5 2.6.6 4.8.3 6.7-.6 4.5-2.2 6.3-8 6.3-17.4Z"/>',
        anchor:   '<circle cx="12" cy="5" r="2.5"/><path d="M12 7.5v13M4 13.5a8 8 0 0 0 16 0M8.5 11h7"/>',
        bookmark: '<path d="M6 3.5h12a1 1 0 0 1 1 1v16.2l-7-4.3-7 4.3V4.5a1 1 0 0 1 1-1Z"/>',
        key:      '<circle cx="7.5" cy="16.5" r="4"/><path d="m10.4 13.7 8.8-8.8M16.5 7.6l2.3 2.3M14 10.1l2.3 2.3"/>',
        wave:     '<path d="M2.5 12c1.6-3.5 3.2-3.5 4.8 0s3.2 3.5 4.8 0 3.2-3.5 4.8 0 3.2 3.5 4.6 0"/><path d="M2.5 17.5c1.6-3.5 3.2-3.5 4.8 0s3.2 3.5 4.8 0 3.2-3.5 4.8 0 3.2 3.5 4.6 0"/>',

        /* -- interface ---------------------------------------------------- */
        search:   '<circle cx="10.8" cy="10.8" r="7"/><path d="m16 16 5 5"/>',
        star:     '<path d="m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.7l6.1-.9Z"/>',
        'star-fill': '<path d="m12 3.2 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.7l6.1-.9Z" fill="currentColor"/>',
        fork:     '<circle cx="6.5" cy="5" r="2.5"/><circle cx="17.5" cy="5" r="2.5"/><circle cx="12" cy="19" r="2.5"/><path d="M6.5 7.5v2a3 3 0 0 0 3 3h5a3 3 0 0 0 3-3v-2M12 12.5v4"/>',
        external: '<path d="M13.5 4.5H19.5V10.5M19.5 4.5 11 13"/><path d="M18 14.5v3.6a2.4 2.4 0 0 1-2.4 2.4H5.9a2.4 2.4 0 0 1-2.4-2.4V8.4A2.4 2.4 0 0 1 5.9 6h3.6"/>',
        github:   '<path d="M9.2 21v-3c0-1 .3-1.7.8-2.1-3-.4-6-1.6-6-6.4 0-1.4.5-2.5 1.3-3.4-.2-.4-.6-1.7.1-3.5 0 0 1-.3 3.4 1.3a11.4 11.4 0 0 1 6.1 0C17.4 2.3 18.4 2.6 18.4 2.6c.7 1.8.3 3.1.1 3.5.8.9 1.3 2 1.3 3.4 0 4.8-3 6-6 6.4.5.4.9 1.3.9 2.5V21"/><path d="M9.2 18.4c-2.5.8-4-.7-4.6-1.6"/>',
        linkedin: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7.5 10.5V17M7.5 7.4h.01M11.5 17v-3.6a2.4 2.4 0 0 1 4.8 0V17M11.5 10.5V17"/>',
        'arrow-up':    '<path d="M12 20V4M5.5 10.5 12 4l6.5 6.5"/>',
        'arrow-down':  '<path d="M12 4v16M5.5 13.5 12 20l6.5-6.5"/>',
        'arrow-right': '<path d="M4 12h16M13.5 5.5 20 12l-6.5 6.5"/>',
        'arrow-left':  '<path d="M20 12H4M10.5 5.5 4 12l6.5 6.5"/>',
        'chev-down':   '<path d="m6 9.5 6 6 6-6"/>',
        'chev-left':   '<path d="m14.5 6-6 6 6 6"/>',
        'chev-right':  '<path d="m9.5 6 6 6-6 6"/>',
        x:        '<path d="M6 6 18 18M18 6 6 18"/>',
        check:    '<path d="m4.5 12.5 5 5 10-11"/>',
        plus:     '<path d="M12 5v14M5 12h14"/>',
        minus:    '<path d="M5 12h14"/>',
        trash:    '<path d="M3.8 6.5h16.4M9 6.5V4.8a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 4.8v1.7"/><path d="M5.8 6.5 6.7 19a2 2 0 0 0 2 1.9h6.6a2 2 0 0 0 2-1.9l.9-12.5M10 10.5v6M14 10.5v6"/>',
        pencil:   '<path d="M4 20h4l10.5-10.5a2.8 2.8 0 0 0-4-4L4 16Z"/><path d="m14 5.5 4 4"/>',
        copy:     '<rect x="8.5" y="8.5" width="12" height="12" rx="2.6"/><path d="M15.5 8.5V6a2.6 2.6 0 0 0-2.6-2.6H6A2.6 2.6 0 0 0 3.4 6v6.9A2.6 2.6 0 0 0 6 15.5h2.5"/>',
        grid:     '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
        list:     '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01"/>',
        sort:     '<path d="M4 7h11M4 12h8M4 17h5M17 8.5v10M17 18.5l3-3M17 18.5l-3-3"/>',
        filter:   '<path d="M3.5 5.5h17l-6.6 7.8v6.2l-3.8-2.3v-3.9Z"/>',
        command:  '<path d="M8.5 8.5h7v7h-7Z"/><path d="M8.5 8.5V6.2a2.7 2.7 0 1 0-2.7 2.3ZM15.5 8.5V6.2a2.7 2.7 0 1 1 2.7 2.3ZM8.5 15.5v2.3a2.7 2.7 0 1 1-2.7-2.3ZM15.5 15.5v2.3a2.7 2.7 0 1 0 2.7-2.3Z"/>',
        eye:      '<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2"/>',
        share:    '<circle cx="17.5" cy="5.5" r="2.8"/><circle cx="6" cy="12" r="2.8"/><circle cx="17.5" cy="18.5" r="2.8"/><path d="m8.5 10.6 6.6-3.7M8.5 13.4l6.6 3.7"/>',
        play:     '<path d="M8 5.4 19 12 8 18.6Z"/>',
        menu:     '<path d="M3.5 7h17M3.5 12h17M3.5 17h17"/>',
        refresh:  '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.8 4.2v5h-5"/>',
        folder:   '<path d="M3 6.6A2.1 2.1 0 0 1 5.1 4.5h3.6l2.1 2.6h8.1A2.1 2.1 0 0 1 21 9.2v8.2a2.1 2.1 0 0 1-2.1 2.1H5.1A2.1 2.1 0 0 1 3 17.4Z"/>',
        info:     '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
        alert:    '<circle cx="12" cy="12" r="9"/><path d="M12 7.2v5.4M12 16.4h.01"/>',
        send:     '<path d="M21 3 10.5 13.5M21 3l-6.6 18-3.9-7.5L3 9.6Z"/>',
        download: '<path d="M12 3.5v11M7.5 10.5 12 15l4.5-4.5M4 17v1.9A2.1 2.1 0 0 0 6.1 21h11.8A2.1 2.1 0 0 0 20 18.9V17"/>',
        branch:   '<circle cx="6.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="8.5" r="2.5"/><path d="M6.5 8v8M17.5 11v.6a4.4 4.4 0 0 1-4.4 4.4H9"/>',
        activity: '<path d="M2.5 12h4l2.5-7 5 14 2.6-7h5"/>',
        vercel:   '<path d="M12 4 21.5 20.5h-19Z"/>',
        drag:     '<path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/>',
        sun:      '<circle cx="12" cy="12" r="4.2"/><path d="M12 1.8v2.6M12 19.6v2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M1.8 12h2.6M19.6 12h2.6M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8"/>',
        moon:     '<path d="M20.5 14.2A8.8 8.8 0 0 1 9.8 3.5a8.8 8.8 0 1 0 10.7 10.7Z"/>',
        monitor:  '<rect x="2.5" y="4" width="19" height="13" rx="2.6"/><path d="M8.5 20.5h7M12 17v3.5"/>',
        undo:     '<path d="M3.5 8.5h9.8a5.7 5.7 0 0 1 0 11.4H8"/><path d="M7 4.5 3.2 8.5 7 12.5"/>',
        wrench:   '<path d="M14.6 6.4a4.6 4.6 0 0 0 5.9 5.9l-8.2 8.2a2.6 2.6 0 0 1-3.7-3.7Z"/><path d="m19 3.5-2.6 2.6"/>',
        arrows:   '<path d="M12 3.5 8.5 7M12 3.5 15.5 7M12 3.5v17M12 20.5 8.5 17M12 20.5 15.5 17"/>',
        doc:      '<path d="M13.5 2.8H7a2.5 2.5 0 0 0-2.5 2.5v13.4A2.5 2.5 0 0 0 7 21.2h10a2.5 2.5 0 0 0 2.5-2.5V8.8Z"/><path d="M13.5 2.8v6h6M8.5 13h7M8.5 16.8h4.5"/>',
        at:       '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 8.4v4.8a3 3 0 0 0 6 0V12a9.5 9.5 0 1 0-3.8 7.6"/>',

        /* -- second wave of project marks --------------------------------- */
        chess:    '<path d="M9 3.5h6M12 3.5v3M8.4 6.5h7.2l-1.1 4.2H9.5Z"/><path d="M9.5 10.7c0 2.6-.9 4.5-2.1 6.3h9.2c-1.2-1.8-2.1-3.7-2.1-6.3"/><path d="M5.5 21h13v-2.5h-13Z"/>',
        cards:    '<rect x="7.5" y="3.5" width="11" height="15" rx="2.4"/><path d="M5.2 6.6 3.6 17.4a2 2 0 0 0 1.7 2.3l7.2 1"/><path d="M13 8.2v6M10 11.2h6"/>',
        trophy:   '<path d="M7.5 3.5h9v5.2a4.5 4.5 0 0 1-9 0Z"/><path d="M7.5 5.2H4.8v1.6a3.2 3.2 0 0 0 2.7 3.2M16.5 5.2h2.7v1.6a3.2 3.2 0 0 1-2.7 3.2"/><path d="M12 13.2v3.6M8.5 20.5h7l-1-3.7h-5Z"/>',
        joystick: '<circle cx="12" cy="6" r="3"/><path d="M12 9v5"/><path d="M6.5 14h11l1.8 6.5H4.7Z"/>',
        wand:     '<path d="m4 20 11-11M14.5 3.2l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9Z"/><path d="M19.4 12.4l.6 1.3 1.3.6-1.3.6-.6 1.3-.6-1.3-1.3-.6 1.3-.6Z"/>',
        shapes:   '<circle cx="7" cy="17" r="4"/><rect x="13" y="13" width="8" height="8" rx="1.8"/><path d="m12 2.5 4.3 7.5H7.7Z"/>',
        pen:      '<path d="M12 19.5H21"/><path d="M15.6 3.9a2.2 2.2 0 0 1 3.1 3.1L8 17.7l-4.2 1.1L4.9 14.6Z"/>',
        crop:     '<path d="M6.5 2.5v13a2 2 0 0 0 2 2h13M2.5 6.5h13a2 2 0 0 1 2 2v13"/>',
        contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" stroke="none"/>',
        type:     '<path d="M4.5 6.5V4.5h15v2M12 4.5v15M8.5 19.5h7"/>',
        speaker:  '<path d="M11.5 4.8 6.8 8.8H3.5v6.4h3.3l4.7 4Z"/><path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.4 6.4a8 8 0 0 1 0 11.2"/>',
        mic:      '<rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5v3M8.5 21.5h7"/>',
        headset:  '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="2.5" y="13.5" width="4.5" height="7" rx="2"/><rect x="17" y="13.5" width="4.5" height="7" rx="2"/>',
        pulse:    '<path d="M2.5 12h4l2-5 4 12 2.5-7h6.5"/>',
        stethos:  '<path d="M5.5 2.8v5.4a4 4 0 0 0 8 0V2.8"/><path d="M4 2.8h3M12 2.8h3M9.5 12.2v2.6a5 5 0 0 0 10 0v-1.4"/><circle cx="19.5" cy="11.5" r="2"/>',
        pill:     '<rect x="2.6" y="8.2" width="18.8" height="7.6" rx="3.8" transform="rotate(-45 12 12)"/><path d="m9 9 6 6"/>',
        seed:     '<path d="M12 21.5V11"/><path d="M12 11c0-4 2.6-7 7-7.5.5 4.9-2.2 7.5-7 7.5ZM12 14c0-3.2-2.1-5.6-5.6-6-.4 3.9 1.8 6 5.6 6Z"/>',
        sun2:     '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2 6 6M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/>',
        rain:     '<path d="M7.5 15a4.3 4.3 0 0 1-.4-8.55 5.3 5.3 0 0 1 10.1-1.35A4.1 4.1 0 0 1 17.5 15Z"/><path d="M8.5 18.2 7.6 20.6M12.2 18.2l-.9 2.4M15.9 18.2l-.9 2.4"/>',
        snow:     '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8"/><path d="m9.4 4.4 2.6 2 2.6-2M9.4 19.6l2.6-2 2.6 2"/>',
        pin:      '<path d="M12 21.5s7-6.2 7-11.2a7 7 0 1 0-14 0c0 5 7 11.2 7 11.2Z"/><circle cx="12" cy="10" r="2.6"/>',
        train:    '<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10h14M8.6 6.4h2M13.4 6.4h2M8.5 13h.01M15.5 13h.01"/><path d="m8 16-2.5 4.5M16 16l2.5 4.5"/>',
        rocket2:  '<path d="M13.5 3.5c4 1.6 6.5 5 7 9.5-4.5-.5-7.9-3-9.5-7Z"/><path d="M11 6c-4.4.6-7 3.2-7.5 7.5C7.8 13 10.4 10.4 11 6Z"/><path d="M3.5 20.5c1.6-.4 3-1.2 4.2-2.4M20.5 20.5c-.4-1.6-1.2-3-2.4-4.2"/>',
        infinity: '<path d="M7 8.4c-2.2 0-3.9 1.6-3.9 3.6S4.8 15.6 7 15.6c3.5 0 6.5-7.2 10-7.2 2.2 0 3.9 1.6 3.9 3.6s-1.7 3.6-3.9 3.6c-3.5 0-6.5-7.2-10-7.2Z"/>',
        scale:    '<path d="M12 3.5v17M6 6.4h12M4.5 20.5h15"/><path d="m6 6.4-3 6a3 3 0 0 0 6 0ZM18 6.4l-3 6a3 3 0 0 0 6 0Z"/>',
        badge:    '<path d="m12 2.6 2.5 1.8 3-.3 1 2.9 2.4 1.9-1.2 2.8 1.2 2.8-2.4 1.9-1 2.9-3-.3L12 21.4l-2.5-1.8-3 .3-1-2.9-2.4-1.9L4.3 12 3.1 9.2l2.4-1.9 1-2.9 3 .3Z"/><path d="m9.2 12 2 2 3.6-3.8"/>',
        blocks:   '<rect x="3" y="3" width="8" height="8" rx="1.8"/><rect x="13" y="3" width="8" height="8" rx="1.8"/><rect x="3" y="13" width="8" height="8" rx="1.8"/><path d="M17 13v8M13 17h8"/>',
        wifi:     '<path d="M2.5 9.2a14 14 0 0 1 19 0M5.8 12.8a9.2 9.2 0 0 1 12.4 0M9 16.3a4.5 4.5 0 0 1 6 0"/><path d="M12 20h.01"/>',
        battery:  '<rect x="2.5" y="7" width="16" height="10" rx="2.6"/><path d="M21.5 10.5v3M5.5 10.5v3M9 10.5v3"/>',
        cpu2:     '<rect x="4" y="4" width="16" height="16" rx="3"/><rect x="9" y="9" width="6" height="6" rx="1.4"/><path d="M9 1.8v2.2M15 1.8v2.2M9 20v2.2M15 20v2.2M1.8 9H4M1.8 15H4M20 9h2.2M20 15h2.2"/>',
        cart2:    '<circle cx="9" cy="20" r="1.6"/><circle cx="18" cy="20" r="1.6"/><path d="M2.5 3.5h2.6l2.2 11.3h11.4l2-8.4H6.2"/>',
        tag:      '<path d="M11.6 2.8H21v9.4l-9.4 9.4a1.8 1.8 0 0 1-2.6 0l-6.8-6.8a1.8 1.8 0 0 1 0-2.6Z"/><path d="M16.8 7.2h.01"/>',
        gift:     '<rect x="2.8" y="8.5" width="18.4" height="4.5" rx="1.4"/><path d="M4.5 13v7.5h15V13M12 8.5v12"/><path d="M12 8.5S10.8 3.5 8.2 3.5a2.4 2.4 0 0 0 0 5ZM12 8.5s1.2-5 3.8-5a2.4 2.4 0 0 1 0 5Z"/>',
        coin:     '<ellipse cx="12" cy="6.4" rx="7.5" ry="3.4"/><path d="M4.5 6.4v11.2c0 1.9 3.4 3.4 7.5 3.4s7.5-1.5 7.5-3.4V6.4"/><path d="M19.5 12c0 1.9-3.4 3.4-7.5 3.4S4.5 13.9 4.5 12"/>',
        news:     '<path d="M3 5.5A1.6 1.6 0 0 1 4.6 4h11.8a1.6 1.6 0 0 1 1.6 1.5v13a1.5 1.5 0 0 0 1.5 1.5H5A2 2 0 0 1 3 18Z"/><path d="M6.5 8h7M6.5 11.5h7M6.5 15h4"/><path d="M18 9h1.5A1.5 1.5 0 0 1 21 10.5V18"/>',
        quote:    '<path d="M9.5 6.5C6.6 7.6 5 10 5 13.2c0 2.6 1.5 4.3 3.6 4.3 1.9 0 3.3-1.4 3.3-3.2 0-1.8-1.2-3.1-2.9-3.1-.3 0-.7 0-1 .2.3-1.6 1.3-2.8 3-3.5ZM19 6.5c-2.9 1.1-4.5 3.5-4.5 6.7 0 2.6 1.5 4.3 3.6 4.3 1.9 0 3.3-1.4 3.3-3.2 0-1.8-1.2-3.1-2.9-3.1-.3 0-.7 0-1 .2.3-1.6 1.3-2.8 3-3.5Z"/>',
        scan:     '<path d="M3.5 8V5.5a2 2 0 0 1 2-2H8M16 3.5h2.5a2 2 0 0 1 2 2V8M20.5 16v2.5a2 2 0 0 1-2 2H16M8 20.5H5.5a2 2 0 0 1-2-2V16"/><path d="M3.5 12h17"/>',
        filter2:  '<path d="M3 5h18M6 12h12M10 19h4"/>',
        shuffle:  '<path d="M17 3.5 20.5 7 17 10.5M17 13.5 20.5 17 17 20.5"/><path d="M3.5 7h3.2c1.2 0 2.3.6 3 1.6l4.6 6.8c.7 1 1.8 1.6 3 1.6h3.2M3.5 17h3.2c1.2 0 2.3-.6 3-1.6l.9-1.3M15.4 9.9l.9-1.3c.7-1 1.8-1.6 3-1.6h1.2"/>',
        repeat:   '<path d="M17 2.5 20.5 6 17 9.5"/><path d="M3.5 12V9a3 3 0 0 1 3-3h14M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12v3a3 3 0 0 1-3 3h-14"/>',
        history:  '<path d="M3.2 12a8.8 8.8 0 1 0 2.7-6.3"/><path d="M3 3.4v4.4h4.4M12 7.4V12l3.4 2"/>',
        moon2:    '<path d="M20.8 13.6A9 9 0 1 1 10.4 3.2a7 7 0 0 0 10.4 10.4Z"/><path d="M17 3.2v3.2M15.4 4.8h3.2"/>',
        target2:  '<path d="M20.5 12a8.5 8.5 0 1 1-4.9-7.7"/><path d="M20.8 4.6 12 13.4l-2.6-2.6"/>',
        bolt2:    '<path d="M12.5 2.5 5.5 12h5l-1 9.5L17 12h-5Z"/><path d="M2.5 8h3M2.5 16h4M18.5 16h3"/>',
        stack:    '<path d="M4 8.5 12 4l8 4.5-8 4.5Z"/><path d="M4 13.2 12 17.7l8-4.5"/>',
        wallet2:  '<path d="M3.5 7.2a2.4 2.4 0 0 1 2.4-2.4h12a1.8 1.8 0 0 1 1.8 1.8v1.4"/><rect x="3.5" y="7.2" width="17" height="12.4" rx="2.8"/><circle cx="16.4" cy="13.4" r="1.4"/>'
    };

    /* Old FontAwesome values → new keys. Anything unmatched falls back to
       `cube`, so a project can never render a blank plaque. */
    const LEGACY = {
        'rocket': 'rocket', 'gamepad': 'gamepad', 'dice': 'dice', 'puzzle-piece': 'puzzle',
        'futbol': 'ball', 'crosshairs': 'target', 'mobile-screen': 'mobile', 'mobile': 'mobile',
        'desktop': 'desktop', 'robot': 'robot', 'brain': 'brain', 'microchip': 'chip',
        'atom': 'atom', 'code': 'code', 'terminal': 'terminal', 'diagram-project': 'flow',
        'network-wired': 'network', 'server': 'server', 'database': 'database', 'globe': 'globe',
        'cloud': 'cloud', 'bolt': 'bolt', 'fire': 'flame', 'chart-line': 'chart-line',
        'chart-pie': 'chart-pie', 'chart-column': 'chart-bar', 'chart-bar': 'chart-bar',
        'table': 'table', 'list-check': 'checklist', 'calendar': 'calendar', 'clock': 'clock',
        'wallet': 'wallet', 'cart-shopping': 'cart', 'shopping-cart': 'cart', 'map': 'map',
        'plane-departure': 'plane', 'plane': 'plane', 'car': 'car', 'camera': 'camera',
        'image': 'image', 'video': 'video', 'film': 'film', 'music': 'music',
        'comments': 'chat', 'comment': 'chat', 'envelope': 'mail', 'book': 'book',
        'graduation-cap': 'cap', 'shield-halved': 'shield', 'shield': 'shield', 'lock': 'lock',
        'wand-magic-sparkles': 'sparkles', 'magic': 'sparkles', 'palette': 'palette',
        'pen-ruler': 'ruler', 'compass': 'compass', 'heart': 'heart', 'dumbbell': 'dumbbell',
        'utensils': 'utensils', 'flask': 'flask', 'layer-group': 'layers', 'cubes': 'cubes',
        'gear': 'gear', 'cog': 'gear', 'link': 'link', 'keyboard': 'keyboard', 'cube': 'cube',
        'star': 'star', 'leaf': 'leaf', 'anchor': 'anchor', 'bookmark': 'bookmark', 'key': 'key',
        'water': 'wave', 'github': 'github', 'linkedin': 'linkedin'
    };

    /* Normalise anything a project might have stored: "fa-rocket",
       "fas fa-rocket", "fa-solid fa-rocket", "rocket".

       Order matters here: drop the *style* tokens first, then strip a leading
       "fa-" off whatever name is left. Doing it the other way round eats the
       "fa" out of "fa-rocket" and leaves "-rocket". */
    const STYLE_TOKEN = /^(fa-solid|fa-regular|fa-brands|fas|far|fab|fa)$/;

    function normalise(name) {
        if (!name) return 'cube';
        const tokens = String(name).trim().toLowerCase().split(/\s+/)
            .filter((t) => t && !STYLE_TOKEN.test(t));
        let key = tokens.length ? tokens[tokens.length - 1] : '';
        key = key.replace(/^fa-/, '');
        if (P[key]) return key;
        if (LEGACY[key] && P[LEGACY[key]]) return LEGACY[key];
        return 'cube';
    }

    /* Returns an <svg> string. `raw:true` skips normalisation for UI icons,
       which are always referenced by their exact key. */
    window.icon = (name, opts = {}) => {
        const key = opts.raw ? (P[name] ? name : 'cube') : normalise(name);
        const size = opts.size || 24;
        const sw = opts.stroke || 1.6;
        const cls = opts.cls ? ` class="${opts.cls}"` : '';
        return `<svg${cls} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" `
             + `stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" `
             + `stroke-linejoin="round" aria-hidden="true" focusable="false">${P[key]}</svg>`;
    };

    /* Replaces every <span data-icon="key"> in a subtree with real SVG. Lets
       index.html stay declarative instead of carrying inline path data. */
    window.hydrateIcons = (root = document) => {
        root.querySelectorAll('[data-icon]').forEach((el) => {
            const key = el.getAttribute('data-icon');
            el.innerHTML = window.icon(key, { raw: true, size: el.getAttribute('data-size') || 24 });
            el.removeAttribute('data-icon');
        });
    };

    window.ICON_KEYS = Object.keys(P);
    window.normaliseIcon = normalise;

    /* Keys offered in the project icon picker, in a deliberate order
       (marks people actually reach for first). */
    window.PICKER_ICONS = [
        'rocket', 'gamepad', 'dice', 'puzzle', 'ball', 'target',
        'mobile', 'desktop', 'robot', 'brain', 'chip', 'atom',
        'code', 'terminal', 'flow', 'network', 'server', 'database',
        'globe', 'cloud', 'bolt', 'flame', 'chart-line', 'chart-pie',
        'chart-bar', 'table', 'checklist', 'calendar', 'clock', 'wallet',
        'cart', 'map', 'plane', 'car', 'camera', 'image',
        'video', 'film', 'music', 'chat', 'mail', 'book',
        'cap', 'shield', 'lock', 'key', 'sparkles', 'palette',
        'ruler', 'compass', 'heart', 'dumbbell', 'utensils', 'flask',
        'layers', 'cubes', 'gear', 'link', 'keyboard', 'cube',
        'leaf', 'anchor', 'bookmark', 'wave',

        'chess', 'cards', 'trophy', 'joystick', 'wand', 'shapes',
        'pen', 'crop', 'contrast', 'type', 'speaker', 'mic',
        'headset', 'pulse', 'stethos', 'pill', 'seed', 'sun2',
        'rain', 'snow', 'pin', 'train', 'rocket2', 'infinity',
        'scale', 'badge', 'blocks', 'wifi', 'battery', 'cpu2',
        'cart2', 'tag', 'gift', 'coin', 'news', 'quote',
        'scan', 'filter2', 'shuffle', 'repeat', 'history', 'moon2',
        'target2', 'bolt2', 'stack', 'wallet2', 'sun', 'moon', 'monitor', 'doc'
    ];

    /* Search terms for the picker's filter box. */
    window.ICON_TERMS = {
        rocket: 'rocket launch startup ship', gamepad: 'game controller play arcade',
        dice: 'dice random board luck', puzzle: 'puzzle logic piece',
        ball: 'ball sport football soccer', target: 'target aim shooter precision',
        mobile: 'mobile phone app ios android', desktop: 'desktop computer pc monitor',
        robot: 'robot bot automation ai', brain: 'brain ai ml machine learning neural',
        chip: 'chip cpu hardware iot embedded', atom: 'atom science physics react',
        code: 'code developer programming source', terminal: 'terminal cli console shell bash',
        flow: 'flow diagram architecture pipeline', network: 'network graph nodes api',
        server: 'server backend hosting infra', database: 'database sql data storage',
        globe: 'globe web website world internet', cloud: 'cloud hosting weather saas',
        bolt: 'bolt fast energy power performance', flame: 'fire firebase hot trending',
        'chart-line': 'chart line graph analytics trend', 'chart-pie': 'chart pie stats share',
        'chart-bar': 'chart bar column dashboard data', table: 'table grid spreadsheet rows',
        checklist: 'checklist todo tasks productivity', calendar: 'calendar date schedule planner',
        clock: 'clock time timer countdown', wallet: 'wallet money finance payments',
        cart: 'cart shopping ecommerce store checkout', map: 'map location geo navigation',
        plane: 'plane travel flight trip', car: 'car driving vehicle transport',
        camera: 'camera photo capture', image: 'image picture gallery photos',
        video: 'video media stream', film: 'film movie cinema',
        music: 'music audio sound player', chat: 'chat comments messaging social',
        mail: 'mail email envelope inbox', book: 'book read library docs',
        cap: 'graduation education school learning course', shield: 'shield security privacy protect',
        lock: 'lock password auth security', key: 'key auth token access',
        sparkles: 'sparkles magic ai generate', palette: 'palette design art colour',
        ruler: 'ruler design ui layout', compass: 'compass explore navigate discover',
        heart: 'heart health love favourite', dumbbell: 'dumbbell fitness gym workout',
        utensils: 'utensils food recipe cooking', flask: 'flask science lab experiment',
        layers: 'layers stack group', cubes: 'cubes blocks 3d modules',
        gear: 'gear settings config tool', link: 'link url chain shortener',
        keyboard: 'keyboard typing input shortcuts', cube: 'cube box generic 3d',
        leaf: 'leaf nature eco green', anchor: 'anchor stable base',
        bookmark: 'bookmark save read later', wave: 'wave audio signal sound',

        chess: 'chess board strategy game', cards: 'cards deck poker game',
        trophy: 'trophy award win leaderboard', joystick: 'joystick arcade retro game',
        wand: 'wand magic generate ai sparkle', shapes: 'shapes geometry abstract',
        pen: 'pen write edit draw note', crop: 'crop frame image editor',
        contrast: 'contrast theme dark light', type: 'type font typography text',
        speaker: 'speaker volume audio sound', mic: 'microphone record voice speech',
        headset: 'headset headphones audio support', pulse: 'pulse heartbeat monitor live',
        stethos: 'stethoscope medical health doctor', pill: 'pill medicine pharmacy health',
        seed: 'seed sprout grow nature plant', sun2: 'sun weather bright day clear',
        rain: 'rain weather shower storm', snow: 'snow winter cold flake',
        pin: 'pin location marker place map', train: 'train transit metro rail transport',
        rocket2: 'rocket launch orbit space', infinity: 'infinity endless loop unlimited',
        scale: 'scale balance justice compare law', badge: 'badge verified quality seal',
        blocks: 'blocks modules grid layout', wifi: 'wifi network signal wireless',
        battery: 'battery power charge energy', cpu2: 'cpu processor chip compute',
        cart2: 'cart shop trolley basket order', tag: 'tag label price category',
        gift: 'gift present reward box', coin: 'coin money currency crypto token',
        news: 'news article paper feed press', quote: 'quote testimonial review words',
        scan: 'scan qr barcode detect', filter2: 'filter sort refine narrow',
        shuffle: 'shuffle random mix reorder', repeat: 'repeat loop sync cycle',
        history: 'history undo timeline past version', moon2: 'moon night sleep dark',
        target2: 'goal target complete achieve', bolt2: 'bolt energy power fast surge',
        stack: 'stack layers pile collection', wallet2: 'wallet card payment money',
        sun: 'sun light theme day', moon: 'moon dark theme night',
        monitor: 'monitor screen display system', doc: 'document file page case study'
    };
})();
