/* ===========================================================================
   SEED DATA — one-time import only.
   ---------------------------------------------------------------------------
   These projects are NOT rendered directly. They exist so that an admin can
   click "Import starter projects" once to push them into Firestore, which is
   the single source of truth for what the site displays.

   After you've imported them once, you can safely delete this file.

   To add a project going forward: use the admin panel (lock icon in footer,
   PIN required) -> "Add New Project". It writes straight to Firestore.

   Fields:
     title    (string)  required
     desc     (string)  required
     link     (string)  required — the live URL
     category (string)  game | tool | app | ai | mobile | web | data | ...
     color    (string)  indigo | blue | red | emerald | purple | orange | ...
     icon     (string)  a FontAwesome class, e.g. "fa-rocket"
     tags     (array)   optional list of strings
     repo     (string)  optional — GitHub URL for the "View Code" button
   =========================================================================== */

window.SEED_PROJECTS = [
    {
        title: "History Heatmap",
        desc: "Visualizing historical data points across time and geography using interactive heatmaps.",
        icon: "fa-fire-alt",
        color: "orange",
        category: "data",
        link: "https://arnav-dugad.github.io/History-Heatmap/",
        repo: "https://github.com/Arnav-Dugad/History-Heatmap",
        tags: ["D3.js", "Data"]
    },
    {
        title: "ArnavOS",
        desc: "A web-based operating system simulation showcasing UI/UX design skills.",
        icon: "fa-desktop",
        color: "blue",
        category: "data",
        link: "https://arnav-dugad.github.io/ArnavOS/",
        repo: "https://github.com/Arnav-Dugad/ArnavOS",
        tags: ["System", "UI/UX"]
    },
    {
        title: "Password Manager",
        desc: "Securely generate and store credentials locally with this utility tool.",
        icon: "fa-lock",
        color: "emerald",
        category: "tool",
        link: "https://arnav-dugad.github.io/Password-Manager/",
        repo: "https://github.com/Arnav-Dugad/Password-Manager",
        tags: ["Security", "Local"]
    },
    {
        title: "Movie Picker",
        desc: "Can't decide what to watch? Let this tool help you discover your next favorite film.",
        icon: "fa-film",
        color: "purple",
        category: "tool",
        link: "https://arnav-dugad.github.io/movies/",
        repo: "https://github.com/Arnav-Dugad/movies",
        tags: ["API", "Fun"]
    },
    {
        title: "Gaming History",
        desc: "A retrospective archive of gaming milestones and personal favorites.",
        icon: "fa-gamepad",
        color: "indigo",
        category: "data",
        link: "https://arnav-dugad.github.io/gaming-history-site/",
        repo: "https://github.com/Arnav-Dugad/gaming-history-site",
        tags: ["Archive", "Blog"]
    },
    {
        title: "Flight Log",
        desc: "Tracking journeys across the globe. A digital logbook for aviation enthusiasts.",
        icon: "fa-plane-departure",
        color: "sky",
        category: "data",
        link: "https://arnav-dugad.github.io/Flight-log/",
        repo: "https://github.com/Arnav-Dugad/Flight-log",
        tags: ["Maps", "Tracking"]
    },
    {
        title: "Driving Game",
        desc: "Test your reflexes in this browser-based driving simulation.",
        icon: "fa-car",
        color: "yellow",
        category: "game",
        link: "https://arnav-dugad.github.io/Driving-game/",
        repo: "https://github.com/Arnav-Dugad/Driving-game",
        tags: ["Canvas", "Arcade"]
    },
    {
        title: "FPS Game",
        desc: "A first-person shooter experience built directly for the web.",
        icon: "fa-crosshairs",
        color: "red",
        category: "game",
        link: "https://arnav-dugad.github.io/fps-game/",
        repo: "https://github.com/Arnav-Dugad/fps-game",
        tags: ["3D", "Action"]
    }
];
