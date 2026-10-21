/* ===========================================================================
   worker/buildfiles.js
   What a project is really built with, and what it needs to run — read
   from its build files rather than guessed from languages:

     *.csproj / Directory.Build.props   .NET version, WPF / WinUI / WinForms,
                                        Windows version, self-contained or not
     app/build.gradle(.kts), libs.versions.toml
                                        minSdk/targetSdk, Jetpack Compose,
                                        Glance widgets, Room, Hilt, Retrofit…
     Package.swift, project.pbxproj     iOS/macOS deployment target, WidgetKit,
                                        Live Activities
     Cargo.toml, tauri.conf.json        Rust, Tauri, egui, Bevy
     package.json                       Electron, React Native, Expo, Capacitor
     pubspec.yaml, pyproject/requirements, go.mod

   One GitHub API call (the file tree); every file itself comes from
   raw.githubusercontent.com, which doesn't count against the API quota.
   =========================================================================== */

import { gh } from './github.js';

const MAX_FILES = 8;

const ANDROID_VERSION = {
    21: '5.0', 22: '5.1', 23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9',
    29: '10', 30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16'
};

/* Windows 10/11 build numbers people recognise. */
const WINDOWS_BUILD = {
    17763: 'Windows 10 (1809)', 18362: 'Windows 10 (1903)', 19041: 'Windows 10 (2004)',
    22000: 'Windows 11', 22621: 'Windows 11 (22H2)', 26100: 'Windows 11 (24H2)'
};

const raw = async (slug, branch, path, cap = 300_000) => {
    try {
        const res = await fetch(`https://raw.githubusercontent.com/${slug}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`, {
            headers: { 'user-agent': 'arnav-portfolio-worker' },
            signal: AbortSignal.timeout(8000)
        });
        if (!res.ok) { res.body?.cancel().catch(() => {}); return ''; }
        return (await res.text()).slice(0, cap);
    } catch { return ''; }
};

const pathOf = (x) => (typeof x === 'string' ? x : x.path);
const depth = (x) => pathOf(x).split('/').length;
const shallowest = (list) => list.slice().sort((a, b) => depth(a) - depth(b) || pathOf(a).length - pathOf(b).length);

/* ---- parsers --------------------------------------------------------------- */

function parseCsproj(text, out) {
    const tag = (name) => (text.match(new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`, 'i')) || [])[1] || '';
    const tfm = (tag('TargetFramework') || tag('TargetFrameworks')).split(';')[0];
    const net = tfm.match(/^net(\d+)\.\d+/i);
    if (net && Number(net[1]) >= 5) out.runtime = `.NET ${net[1]}`;
    else if (/^netcoreapp(\d+\.\d+)/i.test(tfm)) out.runtime = `.NET Core ${tfm.match(/^netcoreapp(\d+\.\d+)/i)[1]}`;
    else if (/^net4\d+/i.test(tfm)) out.runtime = '.NET Framework 4';

    const isWin = /windows/i.test(tfm) || /true/i.test(tag('UseWPF')) || /true/i.test(tag('UseWindowsForms')) || /true/i.test(tag('UseWinUI'));
    if (/true/i.test(tag('UseWPF'))) out.frameworks.add('WPF');
    if (/true/i.test(tag('UseWindowsForms'))) out.frameworks.add('Windows Forms');
    if (/true/i.test(tag('UseWinUI')) || /Microsoft\.WindowsAppSDK/i.test(text)) out.frameworks.add('WinUI 3');
    if (/Microsoft\.Maui/i.test(text)) out.frameworks.add('.NET MAUI');
    const refs = [...text.matchAll(/<PackageReference\s+Include="([^"]+)"/gi)].map((m) => m[1]);
    const PKG = [
        [/^CommunityToolkit\.Mvvm/i, 'MVVM Toolkit'], [/^Wpf\.Ui$|^WPF-UI/i, 'WPF UI'], [/^Velopack/i, 'Velopack'],
        [/^Microsoft\.Data\.Sqlite|^sqlite-net/i, 'SQLite'], [/^Microsoft\.EntityFrameworkCore/i, 'Entity Framework'],
        [/^H\.NotifyIcon|Hardcodet\.NotifyIcon/i, 'Tray icon'], [/^Microsoft\.Toolkit\.Uwp\.Notifications|CommunityToolkit\.WinUI\.Notifications/i, 'Toast notifications'],
        [/^LiveChartsCore|^OxyPlot|^ScottPlot/i, 'Charts'], [/^Serilog/i, 'Serilog'], [/^Newtonsoft\.Json/i, 'Json.NET']
    ];
    for (const r of refs) for (const [re, label] of PKG) if (re.test(r)) out.frameworks.add(label);

    if (isWin) {
        const build = Number((tfm.match(/windows10\.0\.(\d+)/i) || [])[1] || (tag('SupportedOSPlatformVersion').match(/10\.0\.(\d+)/) || [])[1] || 0);
        out.minOs.windows = build ? (WINDOWS_BUILD[build] || `Windows 10 (build ${build})`) : (out.minOs.windows || 'Windows 10');
        out.platforms.add('windows');
    }
    if (/true/i.test(tag('SelfContained')) || /true/i.test(tag('PublishSingleFile')) && /true/i.test(tag('SelfContained'))) out.selfContained = true;
    const rid = tag('RuntimeIdentifier') || tag('RuntimeIdentifiers');
    if (/win-x64/i.test(rid)) out.arch.add('x64');
    if (/win-arm64/i.test(rid)) out.arch.add('ARM64');
}

function parseGradle(text, out) {
    const num = (re) => Number((text.match(re) || [])[1] || 0);
    const minSdk = num(/minSdk(?:Version)?\s*[=(]?\s*(\d{2})/);
    const targetSdk = num(/targetSdk(?:Version)?\s*[=(]?\s*(\d{2})/);
    if (minSdk) { out.minOs.android = ANDROID_VERSION[minSdk] ? `${ANDROID_VERSION[minSdk]} (API ${minSdk})` : `API ${minSdk}`; out.minSdk = minSdk; }
    if (targetSdk) out.targetSdk = targetSdk;
    if (/compose\s*=\s*true|androidx\.compose|libs\.androidx\.compose|compose-bom/i.test(text)) out.frameworks.add('Jetpack Compose');
    const LIBS = [
        [/glance/i, 'Glance widgets'], [/androidx\.room|libs\.room|room-runtime/i, 'Room'], [/hilt/i, 'Hilt'],
        [/retrofit/i, 'Retrofit'], [/ktor/i, 'Ktor'], [/firebase/i, 'Firebase'], [/coil/i, 'Coil'],
        [/work-runtime|androidx\.work/i, 'WorkManager'], [/datastore/i, 'DataStore'], [/kotlinx[.-]serialization/i, 'kotlinx.serialization'],
        [/okhttp/i, 'OkHttp'], [/media3|exoplayer/i, 'Media3'], [/navigation-compose|androidx\.navigation/i, 'Navigation']
    ];
    for (const [re, label] of LIBS) if (re.test(text)) out.frameworks.add(label);
    if (/com\.android\.application|android\s*\{/i.test(text)) out.platforms.add('android');
}

function parseSwift(text, out) {
    const ios = text.match(/\.iOS\(\s*\.v(\d+)(?:_(\d+))?/) || text.match(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*(\d+)(?:\.(\d+))?/);
    const mac = text.match(/\.macOS\(\s*\.v(\d+)(?:_(\d+))?/) || text.match(/MACOSX_DEPLOYMENT_TARGET\s*=\s*(\d+)(?:\.(\d+))?/);
    if (ios) { out.minOs.ios = `${ios[1]}${ios[2] && ios[2] !== '0' ? `.${ios[2]}` : ''}`; out.platforms.add('ios'); }
    if (mac && /macos|MACOSX/i.test(mac[0]) && !/SDKROOT\s*=\s*iphoneos/.test(text)) { out.minOs.macos = `${mac[1]}${mac[2] && mac[2] !== '0' ? `.${mac[2]}` : ''}`; }
    if (/SwiftUI/.test(text)) out.frameworks.add('SwiftUI');
    if (/WidgetKit/.test(text)) out.frameworks.add('WidgetKit');
    if (/ActivityKit/.test(text)) out.frameworks.add('Live Activities');
    if (/AppIntents/.test(text)) out.frameworks.add('App Intents');
}

function parseCargo(text, out) {
    out.frameworks.add('Rust');
    const CRATES = [[/^\s*tauri\s*=|\[dependencies\.tauri\]/m, 'Tauri'], [/^\s*egui\s*=|eframe/m, 'egui'], [/^\s*bevy\s*=/m, 'Bevy'],
        [/^\s*tokio\s*=/m, 'Tokio'], [/^\s*axum\s*=/m, 'Axum'], [/^\s*wgpu\s*=/m, 'wgpu']];
    for (const [re, label] of CRATES) if (re.test(text)) out.frameworks.add(label);
}

function parsePackageJson(text, out) {
    let pkg;
    try { pkg = JSON.parse(text); } catch { return; }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);
    if (has('electron')) { out.frameworks.add('Electron'); ['windows', 'macos', 'linux'].forEach((p) => out.platforms.add(p)); }
    if (has('react-native')) out.frameworks.add('React Native');
    if (has('expo')) out.frameworks.add('Expo');
    if (has('@capacitor/core')) out.frameworks.add('Capacitor');
    if (has('@tauri-apps/api')) out.frameworks.add('Tauri');
    const node = pkg.engines && pkg.engines.node;
    if (node && !out.runtime) out.nodeEngine = String(node).slice(0, 20);
}

function parseTauri(text, out) {
    out.frameworks.add('Tauri');
    try {
        const conf = JSON.parse(text);
        const bundle = (conf.bundle || (conf.tauri && conf.tauri.bundle)) || {};
        const targets = [].concat(bundle.targets || []).join(' ').toLowerCase();
        if (!targets || targets === 'all' || /msi|nsis/.test(targets)) out.platforms.add('windows');
        if (!targets || targets === 'all' || /dmg|app/.test(targets)) out.platforms.add('macos');
        if (!targets || targets === 'all' || /deb|appimage|rpm/.test(targets)) out.platforms.add('linux');
    } catch { /* plain detection is enough */ }
}

function parsePython(text, out) {
    const LIBS = [[/fastapi/i, 'FastAPI'], [/flask/i, 'Flask'], [/django/i, 'Django'], [/torch/i, 'PyTorch'], [/tensorflow/i, 'TensorFlow'],
        [/pandas/i, 'pandas'], [/numpy/i, 'NumPy'], [/streamlit/i, 'Streamlit'], [/pyqt|pyside/i, 'Qt for Python'], [/opencv/i, 'OpenCV']];
    for (const [re, label] of LIBS) if (re.test(text)) out.frameworks.add(label);
}

/* ---- public ---------------------------------------------------------------- */

/* → null when nothing useful was found, else
     { stack: { frameworks[], runtime, minOs{} }, requirements[], platforms[], label } */
export async function analyseBuild(env, slug, branch) {
    const tree = await gh(env, `/repos/${slug}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const files = (tree.data && tree.data.tree || []).filter((t) => t.type === 'blob').map((t) => t.path)
        .filter((p) => !/(^|\/)(node_modules|bin|obj|build|dist|\.git|Pods|DerivedData|vendor)\//.test(p));
    if (!files.length) return null;

    const pick = [];
    const add = (list, n = 1) => { for (const p of shallowest(list).slice(0, n)) if (!pick.find((x) => x.path === p.path)) pick.push(p); };
    const find = (re) => files.filter((p) => re.test(p));

    add(find(/\.csproj$/i).map((path) => ({ path, kind: 'csproj' })), 2);
    add(find(/(^|\/)Directory\.Build\.props$/i).map((path) => ({ path, kind: 'csproj' })));
    add(find(/(^|\/)app\/build\.gradle(\.kts)?$/i).map((path) => ({ path, kind: 'gradle' })));
    if (!pick.some((p) => p.kind === 'gradle')) add(find(/(^|\/)build\.gradle(\.kts)?$/i).map((path) => ({ path, kind: 'gradle' })));
    add(find(/(^|\/)gradle\/libs\.versions\.toml$/i).map((path) => ({ path, kind: 'gradle' })));
    add(find(/(^|\/)Package\.swift$/).map((path) => ({ path, kind: 'swift' })));
    add(find(/\.xcodeproj\/project\.pbxproj$/).map((path) => ({ path, kind: 'swift' })));
    add(find(/(^|\/)Cargo\.toml$/).map((path) => ({ path, kind: 'cargo' })));
    add(find(/(^|\/)tauri\.conf\.json$/).map((path) => ({ path, kind: 'tauri' })));
    add(find(/^package\.json$/).map((path) => ({ path, kind: 'pkg' })));
    add(find(/(^|\/)pubspec\.yaml$/).map((path) => ({ path, kind: 'flutter' })));
    add(find(/(^|\/)(requirements\.txt|pyproject\.toml)$/).map((path) => ({ path, kind: 'python' })));
    if (files.includes('go.mod')) pick.push({ path: 'go.mod', kind: 'go' });

    const chosen = pick.slice(0, MAX_FILES);
    if (!chosen.length) return null;
    const texts = await Promise.all(chosen.map((f) => raw(slug, branch, f.path, f.path.endsWith('.pbxproj') ? 400_000 : 200_000)));

    const out = { frameworks: new Set(), minOs: {}, runtime: '', platforms: new Set(), arch: new Set(), selfContained: false };
    chosen.forEach((f, i) => {
        const t = texts[i];
        if (!t) return;
        if (f.kind === 'csproj') parseCsproj(t, out);
        else if (f.kind === 'gradle') parseGradle(t, out);
        else if (f.kind === 'swift') parseSwift(t, out);
        else if (f.kind === 'cargo') parseCargo(t, out);
        else if (f.kind === 'tauri') parseTauri(t, out);
        else if (f.kind === 'pkg') parsePackageJson(t, out);
        else if (f.kind === 'flutter') { out.frameworks.add('Flutter'); if (/sdk:\s*flutter/.test(t)) { out.platforms.add('android'); out.platforms.add('ios'); } }
        else if (f.kind === 'python') parsePython(t, out);
        else if (f.kind === 'go') out.frameworks.add('Go');
    });

    const requirements = [];
    if (out.minOs.windows) requirements.push(`${out.minOs.windows} or later`);
    if (out.runtime && /^\.NET/.test(out.runtime) && !out.selfContained && out.platforms.has('windows')) {
        const desktop = out.frameworks.has('WPF') || out.frameworks.has('Windows Forms');
        requirements.push(`${out.runtime}${desktop ? ' Desktop' : ''} Runtime`);
    }
    if (out.arch.size) requirements.push(`${[...out.arch].join(' / ')} processor`);
    if (out.minOs.android) requirements.push(`Android ${out.minOs.android} or later`);
    if (out.minOs.ios) requirements.push(`iOS ${out.minOs.ios} or later`);
    // Xcode projects carry a macOS target by default; only list it when the
    // project really ships for the Mac.
    if (out.minOs.macos && (out.platforms.has('macos') || !out.minOs.ios)) requirements.push(`macOS ${out.minOs.macos} or later`);
    else delete out.minOs.macos;

    const frameworks = [...out.frameworks];
    if (out.runtime && !frameworks.includes(out.runtime)) frameworks.unshift(out.runtime);
    if (!frameworks.length && !requirements.length) return null;

    const label = [...new Set([out.runtime, ...[...out.frameworks].slice(0, 3)]), requirements[0]]
        .filter(Boolean).join(' · ');
    return {
        stack: { frameworks: frameworks.slice(0, 14), runtime: out.runtime || '', minOs: out.minOs },
        requirements: requirements.slice(0, 6),
        platforms: [...out.platforms],
        label: label || 'Build files read'
    };
}
