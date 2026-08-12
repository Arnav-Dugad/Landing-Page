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
        at:       '<circle cx="12" cy="12" r="3.6"/><path d="M15.6 8.4v4.8a3 3 0 0 0 6 0V12a9.5 9.5 0 1 0-3.8 7.6"/>'
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
        'leaf', 'anchor', 'bookmark', 'wave'
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
        bookmark: 'bookmark save read later', wave: 'wave audio signal sound'
    };
})();
