// ==UserScript==
// @name         Bonk.io Server Selector
// @namespace    bonk.server.selector
// @version      1.0.0
// @description  Pick an official server for rooms you create, with a location map, saved preferences, and connection-speed tests.
// @author       george07
// @license      MIT
// @match        https://bonk.io/*
// @match        https://bonkisback.io/*
// @match        https://multiplayer.gg/physics/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    "use strict";

    var CATALOG_KEY = "bonkServerSelector.endpointCatalog.v1";
    var PREFERENCE_KEY = "bonkServerSelector.preference.v1";
    var RELOAD_MESSAGE = "bonkServerSelector.applyAndReload.v1";

    /**
     * Returns the bundled official endpoints and approximate city-center coordinates.
     * These entries work without contacting a geolocation service.
     * @returns {Array<Object>} Built-in endpoint records.
     */
    function seedEndpoints() {
        return [
            { server: "b2amsterdam1", label: "Amsterdam, Netherlands", country: "NL", latitude: 52.3676, longitude: 4.9041 },
            { server: "b2atlanta1", label: "Atlanta, United States", country: "US", latitude: 33.7490, longitude: -84.3880 },
            { server: "b2brazil1", label: "Sao Paulo, Brazil", country: "BR", latitude: -23.5505, longitude: -46.6333 },
            { server: "b2dallas1", label: "Dallas, United States", country: "US", latitude: 32.7767, longitude: -96.7970 },
            { server: "b2florida1", label: "Miami, United States", country: "US", latitude: 25.7617, longitude: -80.1918 },
            { server: "b2la1", label: "Los Angeles, United States", country: "US", latitude: 34.0522, longitude: -118.2437 },
            { server: "b2ny1", label: "New York, United States", country: "US", latitude: 40.7128, longitude: -74.0060 },
            { server: "b2river1", label: "Chicago area, United States", country: "US", latitude: 41.8781, longitude: -87.6298 },
            { server: "b2sanfrancisco1", label: "San Francisco, United States", country: "US", latitude: 37.7749, longitude: -122.4194 },
            { server: "b2seattle1", label: "Seattle, United States", country: "US", latitude: 47.6062, longitude: -122.3321 },
            { server: "b2seoul1", label: "Seoul, South Korea", country: "KR", latitude: 37.5660, longitude: 126.9784 },
            { server: "b2sydney1", label: "Sydney, Australia", country: "AU", latitude: -33.8688, longitude: 151.2093 },
            { server: "b2telaviv1", label: "Tel Aviv, Israel", country: "IL", latitude: 32.0853, longitude: 34.7818 },
            { server: "b2toronto1", label: "Toronto, Canada", country: "CA", latitude: 43.6532, longitude: -79.3832 },
            { server: "b2warsaw1", label: "Warsaw, Poland", country: "PL", latitude: 52.2297, longitude: 21.0122 }
        ];
    }

    /**
     * Normalizes an endpoint alias and rejects URLs, paths, and arbitrary hosts.
     * @param {unknown} value Candidate alias, such as "b2seoul1".
     * @returns {string} Validated alias, or an empty string.
     */
    function validServer(value) {
        var normalized = String(value || "").trim().toLowerCase();
        return /^b2[a-z0-9-]{1,40}$/.test(normalized) ? normalized : "";
    }

    /**
     * Reads the saved selection. Invalid data or unavailable storage uses automatic allocation.
     * @param {Storage} storage The current origin's local storage.
     * @returns {{mode: string, server: string}} The saved preference.
     */
    function readPreference(storage) {
        try {
            var stored = storage.getItem(PREFERENCE_KEY) || "null";
            var saved = JSON.parse(stored);
            if (saved && saved.mode === "server" && validServer(saved.server)) {
                return { mode: "server", server: validServer(saved.server) };
            }
        } catch (error) {
            // Invalid or unavailable storage falls back to Bonk automatic.
        }
        return { mode: "auto", server: "" };
    }

    /**
     * Persists a selection without throwing when browser storage is blocked or full.
     * @param {Storage} storage The current origin's local storage.
     * @param {{mode: string, server: string}} preference Selection to save.
     * @returns {boolean} Whether saving succeeded.
     */
    function writePreference(storage, preference) {
        try {
            storage.setItem(PREFERENCE_KEY, JSON.stringify(preference));
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Receives reload requests only from Bonk's main game iframe.
     * Reloading the whole page lets the game consume the selection during initialization.
     * @returns {void}
     */
    function installTopReloadListener() {
        window.addEventListener("message", function (event) {
            if (!event.data || event.data.type !== RELOAD_MESSAGE) {
                return;
            }
            var frame = document.getElementById("maingameframe");
            if (!frame || event.source !== frame.contentWindow) {
                return;
            }
            window.location.reload();
        });
    }


    if (window.top === window.self) {
        installTopReloadListener();
        return;
    }

    var isGameFrame = false;
    try {
        isGameFrame = (window.frameElement && window.frameElement.id === "maingameframe") ||
            /gameframe/i.test(window.location.pathname);
    } catch (error) {
        isGameFrame = /gameframe/i.test(window.location.pathname);
    }
    if (!isGameFrame || window.__bonkServerSelectorInstalled) {
        return;
    }
    window.__bonkServerSelectorInstalled = true;
    initialize(window, document);

    /**
     * Installs the allocation hook in the game frame immediately, then waits for its UI.
     * The preference is fixed for this page load; changing it requires a reload.
     * @param {Window} gameWindow Bonk's game-frame window.
     * @param {Document} gameDocument Bonk's game-frame document.
     * @returns {void}
     */
    function initialize(gameWindow, gameDocument) {
        var NativeWebSocket = gameWindow.WebSocket;

        var endpointCatalog = loadEndpointCatalog();
        var endpointPreference = { mode: "auto", server: "" };
        try {
            endpointPreference = readPreference(gameWindow.localStorage);
        } catch (error) {
            // Storage can be disabled by the browser; keep normal allocation.
        }
        var bootPreference = {
            mode: endpointPreference.mode,
            server: endpointPreference.server
        };
        var allocationOverrideAvailable = false;
        var allocationOverrideObserved = false;

        var picker = null;
        var map = null;
        var list = null;
        var status = null;
        var serverButton = null;
        var toastTimer = 0;
        var reloadScheduled = false;
        var OFFICIAL_SUFFIX = ".bonk.io";
        var locationJobs = Object.create(null);
        var locationQueue = [];
        var locationWorkers = 0;

        saveEndpointCatalog();
        gameWindow.setTimeout(function () {
            Object.keys(endpointCatalog).forEach(queueLocation);
        }, 0);

        function cleanServer(value) {
            return validServer(value);
        }

        /**
         * Validates a coordinate without coercing null, blanks, or booleans to zero.
         * @param {unknown} value Numeric value or numeric string.
         * @param {number} minimum Inclusive lower bound.
         * @param {number} maximum Inclusive upper bound.
         * @returns {number|null} Valid coordinate, or null when unknown.
         */
        function finiteCoordinate(value, minimum, maximum) {
            if (value === null || value === undefined ||
                (typeof value !== "number" && typeof value !== "string") ||
                (typeof value === "string" && !value.trim())) {
                return null;
            }
            var numeric = Number(value);
            return Number.isFinite(numeric) && numeric >= minimum && numeric <= maximum ? numeric : null;
        }

        /**
         * Validates cached or discovered data and merges missing fields with a fallback.
         * Only built-in or IP-geolocated entries receive map coordinates.
         * @param {Object} record Candidate endpoint record.
         * @param {Object|null} fallback Existing endpoint, if available.
         * @returns {Object|null} Normalized record, or null for an invalid alias.
         */
        function sanitizeEndpoint(record, fallback) {
            var server = cleanServer(record && record.server);
            if (!server) {
                return null;
            }
            var base = fallback || {};
            var seed = seedEndpoints().find(function (item) { return item.server === server; });
            // Built-in locations take precedence; unknown entries need a lookup source.
            if (seed) {
                record = Object.assign({}, record, seed);
            } else if (record.locationSource !== "ipwho.is") {
                record = Object.assign({}, record, { latitude: null, longitude: null });
                base = Object.assign({}, base, { latitude: null, longitude: null });
            }
            var latitude = finiteCoordinate(record.latitude, -90, 90);
            var longitude = finiteCoordinate(record.longitude, -180, 180);
            var hasPing = record.lastPingMs !== null && record.lastPingMs !== "" &&
                typeof record.lastPingMs !== "undefined";
            var ping = hasPing ? Number(record.lastPingMs) : NaN;
            return {
                server: server,
                locationSource: seed ? "catalog" : (record.locationSource === "ipwho.is" ? "ipwho.is" : ""),
                locationCheckedAt: Number(record.locationCheckedAt) || 0,
                locationAttemptAt: Number(record.locationAttemptAt) || 0,
                label: typeof record.label === "string" && record.label.trim() ?
                    record.label.trim().slice(0, 80) : (base.label || server),
                country: /^[A-Z]{2}$/.test(String(record.country || "").toUpperCase()) ?
                    String(record.country).toUpperCase() : (base.country || ""),
                latitude: latitude === null ? finiteCoordinate(base.latitude, -90, 90) : latitude,
                longitude: longitude === null ? finiteCoordinate(base.longitude, -180, 180) : longitude,
                firstSeen: Number.isFinite(Number(record.firstSeen)) ? Number(record.firstSeen) :
                    (Number(base.firstSeen) || Date.now()),
                lastSeen: Number.isFinite(Number(record.lastSeen)) ? Number(record.lastSeen) :
                    (Number(base.lastSeen) || Date.now()),
                lastPingMs: Number.isFinite(ping) && ping >= 0 && ping < 30000 ? ping :
                    (typeof base.lastPingMs === "number" && Number.isFinite(base.lastPingMs) ? base.lastPingMs : null),
                lastPingAt: Number.isFinite(Number(record.lastPingAt)) ? Number(record.lastPingAt) :
                    (Number(base.lastPingAt) || 0),
                lastProbeOk: typeof record.lastProbeOk === "boolean" ? record.lastProbeOk :
                    (typeof base.lastProbeOk === "boolean" ? base.lastProbeOk : null)
            };
        }

        /**
         * Combines bundled endpoints with valid locally cached discovery and probe results.
         * @returns {Object<string, Object>} Catalog indexed by endpoint alias.
         */
        function loadEndpointCatalog() {
            var catalog = Object.create(null);
            seedEndpoints().forEach(function (seed) {
                var endpoint = sanitizeEndpoint(seed, null);
                if (endpoint) {
                    endpoint.firstSeen = 0;
                    endpoint.lastSeen = 0;
                    catalog[endpoint.server] = endpoint;
                }
            });

            var stored = "";
            try {
                stored = gameWindow.localStorage.getItem(CATALOG_KEY) || "[]";
                var parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    parsed.forEach(function (record) {
                        var server = cleanServer(record && record.server);
                        var endpoint = sanitizeEndpoint(record, server ? catalog[server] : null);
                        if (endpoint) {
                            catalog[endpoint.server] = endpoint;
                        }
                    });
                }
            } catch (error) {
                // Damaged local data is ignored and rebuilt from trusted seeds.
            }
            return catalog;
        }

        /**
         * Saves the catalog locally. If storage is unavailable, it remains usable in memory.
         * @returns {void}
         */
        function saveEndpointCatalog() {
            try {
                gameWindow.localStorage.setItem(CATALOG_KEY,
                    JSON.stringify(Object.keys(endpointCatalog).map(function (server) {
                        return endpointCatalog[server];
                    })));
            } catch (error) {
                // The selector remains usable for this page load without persistence.
            }
        }

        /**
         * Adds or updates an official endpoint, persists it, and schedules location discovery.
         * @param {string} serverValue Official endpoint alias.
         * @param {Object} [patch] Fields supplied by a probe or location lookup.
         * @returns {Object|null} Updated endpoint, or null for an invalid alias.
         */
        function rememberEndpoint(serverValue, patch) {
            var server = cleanServer(serverValue);
            if (!server) {
                return null;
            }
            var previous = endpointCatalog[server] || { server: server, label: server };
            var merged = {
                server: server,
                locationSource: previous.locationSource,
                locationCheckedAt: previous.locationCheckedAt,
                locationAttemptAt: previous.locationAttemptAt,
                label: previous.label,
                country: previous.country,
                latitude: previous.latitude,
                longitude: previous.longitude,
                firstSeen: previous.firstSeen || Date.now(),
                lastSeen: Date.now(),
                lastPingMs: previous.lastPingMs,
                lastPingAt: previous.lastPingAt,
                lastProbeOk: previous.lastProbeOk
            };
            if (patch && typeof patch === "object") {
                Object.keys(patch).forEach(function (key) {
                    merged[key] = patch[key];
                });
            }
            var trustedSeed = seedEndpoints().filter(function (seed) {
                return seed.server === server;
            })[0];
            var endpoint = sanitizeEndpoint(merged, trustedSeed || previous);
            if (!endpoint) {
                return null;
            }
            endpointCatalog[server] = endpoint;
            saveEndpointCatalog();
            queueLocation(server);
            return endpoint;
        }

        /**
         * Fetches public lookup data without cookies or referrers, with an eight-second timeout.
         * @param {string} url HTTPS DNS or geolocation service URL.
         * @returns {Promise<Object>} Parsed JSON; rejects on HTTP, parsing, or timeout errors.
         */
        function locationJson(url) {
            var controller = new gameWindow.AbortController();
            var timer = gameWindow.setTimeout(function () { controller.abort(); }, 8000);
            return gameWindow.fetch(url, {
                credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal
            }).then(function (response) {
                if (!response.ok) { throw new Error("Location lookup HTTP " + response.status); }
                return response.json();
            }).finally(function () { gameWindow.clearTimeout(timer); });
        }

        /**
         * Queues an IP-location lookup unless the endpoint is built-in, cached, or already queued.
         * Successful results last 30 days; failed attempts are retried after one hour.
         * @param {string} server Catalog alias.
         * @returns {Promise<void>} Settles when the lookup finishes or is skipped.
         */
        function queueLocation(server) {
            var endpoint = endpointCatalog[server];
            if (locationJobs[server]) { return locationJobs[server]; }
            if (!endpoint || endpoint.locationSource === "catalog") {
                return Promise.resolve();
            }
            var now = Date.now();
            if ((endpoint.locationCheckedAt && now - endpoint.locationCheckedAt < 30 * 86400000) ||
                (endpoint.locationAttemptAt && now - endpoint.locationAttemptAt < 3600000)) {
                return Promise.resolve();
            }
            locationJobs[server] = new Promise(function (resolve) {
                locationQueue.push({ server: server, resolve: resolve });
            });
            runLocationQueue();
            return locationJobs[server];
        }

        /**
         * Starts queued lookups, allowing at most two to run concurrently.
         * @returns {void}
         */
        function runLocationQueue() {
            while (locationWorkers < 2 && locationQueue.length) {
                startLocationJob(locationQueue.shift());
            }
        }

        /**
         * Resolves an official hostname through Google Public DNS, then locates that IP
         * through ipwho.is. Failures preserve existing data and never invent coordinates.
         * @param {{server: string, resolve: Function}} job Queued lookup and completion callback.
         * @returns {void}
         */
        function startLocationJob(job) {
            locationWorkers += 1;
            endpointCatalog[job.server].locationAttemptAt = Date.now();
            saveEndpointCatalog();
            // Resolve the server IP explicitly: never use the API's caller-IP default.
            locationJson("https://dns.google/resolve?name=" +
                encodeURIComponent(endpointHost(job.server)) + "&type=A")
                .then(function (dns) {
                    var answer = dns && dns.Status === 0 && Array.isArray(dns.Answer) &&
                        dns.Answer.find(function (item) {
                            return item.type === 1 && typeof item.data === "string" &&
                                /^(\d{1,3}\.){3}\d{1,3}$/.test(item.data) &&
                                item.data.split(".").every(function (part) { return Number(part) <= 255; });
                        });
                    if (!answer) { throw new Error("No server IPv4 address"); }
                    return locationJson("https://ipwho.is/" + encodeURIComponent(answer.data));
                }).then(function (geo) {
                    var latitude = finiteCoordinate(geo.latitude, -90, 90);
                    var longitude = finiteCoordinate(geo.longitude, -180, 180);
                    if (geo.success !== true || latitude === null || longitude === null ||
                        !/^[A-Z]{2}$/.test(geo.country_code) ||
                        typeof geo.country !== "string" || !geo.country.trim()) {
                        throw new Error("Incomplete server location");
                    }
                    var city = typeof geo.city === "string" ? geo.city.trim() : "";
                    rememberEndpoint(job.server, {
                        label: (city ? city + ", " : "") + geo.country.trim(),
                        country: geo.country_code, latitude: latitude, longitude: longitude,
                        locationSource: "ipwho.is", locationCheckedAt: Date.now()
                    });
                }).catch(function () {
                    // Keep failed lookups in the list, without inventing a map position.
                }).finally(function () {
                    delete locationJobs[job.server];
                    locationWorkers -= 1;
                    renderPicker(false);
                    job.resolve();
                    runLocationQueue();
                });
        }

        function endpointHost(server) {
            var clean = cleanServer(server);
            return clean ? clean + OFFICIAL_SUFFIX : "";
        }

        /**
         * Matches only Bonk's HTTPS room-list API, which supplies the create-server allocation.
         * @param {unknown} value Request URL.
         * @returns {boolean} Whether this is the room-list endpoint.
         */
        function isRoomListRequest(value) {
            try {
                var parsed = new gameWindow.URL(String(value || ""), gameWindow.location.href);
                return parsed.protocol === "https:" && parsed.hostname === "bonk2.io" &&
                    parsed.pathname.toLowerCase().endsWith("/scripts/getrooms.php");
            } catch (error) {
                return false;
            }
        }

        /**
         * Replaces only createserver in a room-list JSON response using the startup selection.
         * Room records, location metadata, and existing-room join addresses are untouched.
         * @param {XMLHttpRequest} request Request tagged by the allocation hook.
         * @param {string} raw Native response text.
         * @returns {string} Original or rewritten JSON.
         */
        function rewriteAllocationText(request, raw) {
            var target = bootPreference.mode === "server" ? cleanServer(bootPreference.server) : "";
            if (!target || !request.__bssRoomListRequest || typeof raw !== "string" ||
                raw.length > 4000000 || raw.indexOf("createserver") === -1) {
                return raw;
            }
            if (request.__bssAllocationRaw === raw && typeof request.__bssAllocationText === "string") {
                return request.__bssAllocationText;
            }
            try {
                var parsed = JSON.parse(raw);
                if (!parsed || typeof parsed.createserver !== "string") {
                    return raw;
                }
                rememberEndpoint(parsed.createserver);
                parsed.createserver = target;
                rememberEndpoint(target);
                request.__bssAllocationRaw = raw;
                request.__bssAllocationText = JSON.stringify(parsed);
                allocationOverrideObserved = true;
                return request.__bssAllocationText;
            } catch (error) {
                return raw;
            }
        }

        /**
         * Applies the same allocation override to an XHR JSON response without mutating it.
         * @param {XMLHttpRequest} request Request tagged by the allocation hook.
         * @param {unknown} raw Native response value.
         * @returns {unknown} Original response or a shallow copy with the selected createserver.
         */
        function rewriteAllocationObject(request, raw) {
            var target = bootPreference.mode === "server" ? cleanServer(bootPreference.server) : "";
            if (!target || !request.__bssRoomListRequest || !raw || typeof raw !== "object" ||
                typeof raw.createserver !== "string") {
                return raw;
            }
            rememberEndpoint(raw.createserver);
            rememberEndpoint(target);
            allocationOverrideObserved = true;
            var rewritten = Object.assign({}, raw);
            rewritten.createserver = target;
            return rewritten;
        }

        /**
         * Hooks XHR response getters before Bonk reads its room-list allocation.
         * Does not redirect transports or alter room-join responses.
         * @returns {boolean} Whether overriding is available, or automatic mode needs no override.
         */
        function installAllocationHook() {
            var prototype = gameWindow.XMLHttpRequest && gameWindow.XMLHttpRequest.prototype;
            if (!prototype || typeof prototype.open !== "function") {
                return false;
            }
            var nativeOpen = prototype.open;
            prototype.open = function (method, url) {
                this.__bssRoomListRequest = isRoomListRequest(url);
                this.__bssAllocationRaw = null;
                this.__bssAllocationText = null;
                return nativeOpen.apply(this, arguments);
            };

            var responseTextDescriptor = Object.getOwnPropertyDescriptor(prototype, "responseText");
            if (responseTextDescriptor && typeof responseTextDescriptor.get === "function" &&
                responseTextDescriptor.configurable) {
                Object.defineProperty(prototype, "responseText", Object.assign({}, responseTextDescriptor, {
                    get: function () {
                        return rewriteAllocationText(this, responseTextDescriptor.get.call(this));
                    }
                }));
                allocationOverrideAvailable = true;
            }

            var responseDescriptor = Object.getOwnPropertyDescriptor(prototype, "response");
            if (responseDescriptor && typeof responseDescriptor.get === "function" &&
                responseDescriptor.configurable) {
                Object.defineProperty(prototype, "response", Object.assign({}, responseDescriptor, {
                    get: function () {
                        var raw = responseDescriptor.get.call(this);
                        return typeof raw === "string" ? rewriteAllocationText(this, raw) :
                            rewriteAllocationObject(this, raw);
                    }
                }));
                allocationOverrideAvailable = true;
            }
            return allocationOverrideAvailable || bootPreference.mode !== "server";
        }

        function selectedEndpoint() {
            return endpointPreference.mode === "server" ? endpointCatalog[endpointPreference.server] : null;
        }

        function endpointName(endpoint) {
            return endpoint ? endpoint.label + " (" + endpoint.server + ")" : "Bonk automatic";
        }

        /**
         * Saves a validated selection and requests a full reload when it differs from startup.
         * @param {"auto"|"server"} mode Allocation mode.
         * @param {string} server Endpoint alias; ignored in automatic mode.
         * @returns {boolean} Whether the selection was accepted and persisted.
         */
        function setPreference(mode, server) {
            var next;
            if (mode === "server") {
                var clean = cleanServer(server);
                if (!clean || !endpointCatalog[clean]) {
                    showToast("That official endpoint is not in the saved catalog.");
                    return false;
                }
                next = { mode: "server", server: clean };
            } else {
                next = { mode: "auto", server: "" };
            }
            var saved = false;
            try {
                saved = writePreference(gameWindow.localStorage, next);
            } catch (error) {
                // Accessing localStorage itself can throw in restricted contexts.
            }
            if (!saved) {
                showToast("Browser storage is unavailable; the server choice could not be saved.");
                return false;
            }
            if (next.mode === bootPreference.mode && next.server === bootPreference.server) {
                endpointPreference = next;
                updateServerButton();
                renderPicker();
                showToast("That server is already active for this page load.");
                return true;
            }
            endpointPreference = next;
            updateServerButton();
            renderPicker();
            if (!reloadScheduled) {
                reloadScheduled = true;
                showToast("Saving the server and reloading Bonk...");
                gameWindow.setTimeout(function () {
                    try {
                        gameWindow.top.postMessage({ type: RELOAD_MESSAGE }, "*");
                    } catch (error) {
                        gameWindow.location.reload();
                    }
                }, 450);
            }
            return true;
        }

        function updateServerButton() {
            if (!serverButton) {
                return;
            }
            var endpoint = selectedEndpoint();
            serverButton.textContent = "Server: " + (endpoint ? endpoint.label : "Automatic");
            serverButton.title = endpoint ? endpointName(endpoint) :
                "Let Bonk choose the room server automatically";
        }

        function showToast(message) {
            var toast = gameDocument.getElementById("bss-toast");
            if (!toast) {
                toast = gameDocument.createElement("div");
                toast.id = "bss-toast";
                gameDocument.body.appendChild(toast);
            }
            toast.textContent = String(message);
            toast.style.display = "block";
            if (toastTimer) {
                gameWindow.clearTimeout(toastTimer);
            }
            toastTimer = gameWindow.setTimeout(function () {
                toast.style.display = "none";
            }, 4200);
        }

        /**
         * Measures elapsed WebSocket connection setup time, then closes the probe socket.
         * This is a connection estimate, not in-game ping or a guarantee a room can be created.
         * @param {string} server Official endpoint alias.
         * @param {number} [timeoutMs=3000] Maximum connection wait in milliseconds.
         * @returns {Promise<{ok: boolean, server: string, ping: number|null}>} Probe result.
         */
        function probeEndpoint(server, timeoutMs) {
            return new Promise(function (resolve) {
                var clean = cleanServer(server);
                if (!clean) {
                    resolve({ ok: false, server: "", ping: null });
                    return;
                }
                var socket;
                var finished = false;
                var startedAt = gameWindow.performance.now();
                var timeout = gameWindow.setTimeout(function () { finish(false); }, timeoutMs || 3000);

                function finish(ok) {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    gameWindow.clearTimeout(timeout);
                    var ping = ok ? Math.max(0, Math.round(gameWindow.performance.now() - startedAt)) : null;
                    if (socket && socket.readyState < NativeWebSocket.CLOSING) {
                        socket.close();
                    }
                    rememberEndpoint(clean, {
                        lastPingMs: ping,
                        lastPingAt: Date.now(),
                        lastProbeOk: ok
                    });
                    resolve({ ok: ok, server: clean, ping: ping });
                }

                try {
                    socket = new NativeWebSocket("wss://" + endpointHost(clean) +
                        "/socket.io/?EIO=3&transport=websocket&t=" + Date.now());
                    socket.addEventListener("open", function () { finish(true); }, { once: true });
                    socket.addEventListener("error", function () { finish(false); }, { once: true });
                    socket.addEventListener("close", function () { finish(false); }, { once: true });
                } catch (error) {
                    finish(false);
                }
            });
        }

        /**
         * Probes the saved catalog with four workers and selects the fastest responding endpoint.
         * A changed selection triggers a page reload.
         * @returns {Promise<Object|null>} Best probe result, or null if none responded.
         */
        function testAndSelectFastest() {
            var servers = Object.keys(endpointCatalog);
            var cursor = 0;
            var completed = 0;
            var successful = [];
            if (status) {
                status.textContent = "Testing 0/" + servers.length + " official endpoints...";
            }

            function worker() {
                if (cursor >= servers.length) {
                    return Promise.resolve();
                }
                var server = servers[cursor];
                cursor += 1;
                return probeEndpoint(server, 3200).then(function (result) {
                    completed += 1;
                    if (result.ok) {
                        successful.push(result);
                    }
                    if (status) {
                        status.textContent = "Testing " + completed + "/" + servers.length +
                            " official endpoints...";
                    }
                    renderPicker(false);
                    return worker();
                });
            }

            return Promise.all([worker(), worker(), worker(), worker()]).then(function () {
                successful.sort(function (left, right) { return left.ping - right.ping; });
                if (!successful.length) {
                    if (status) {
                        status.textContent = "No saved endpoint completed the WebSocket probe.";
                    }
                    showToast("No endpoint responded; use Bonk automatic.");
                    return null;
                }
                var fastest = successful[0];
                if (!setPreference("server", fastest.server)) {
                    return null;
                }
                if (status) {
                    status.textContent = "Selected " + endpointName(endpointCatalog[fastest.server]) +
                        " at " + fastest.ping + " ms.";
                }
                showToast("Fastest endpoint: " + endpointCatalog[fastest.server].label +
                    " at " + fastest.ping + " ms.");
                return fastest;
            });
        }

        /**
         * Posts a form to Bonk's public discovery API without account credentials.
         * @param {string} url Official API URL.
         * @param {string} body URL-encoded form body.
         * @returns {Promise<Object>} Parsed response.
         */
        function postFormJson(url, body) {
            return gameWindow.fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: body,
                credentials: "omit",
                cache: "no-store"
            }).then(function (response) {
                if (!response.ok) {
                    throw new Error("HTTP " + response.status);
                }
                return response.json();
            });
        }

        /**
         * Samples up to 64 public rooms using three workers and indexes their server aliases.
         * New locations are resolved automatically; closed rooms and failed lookups are tolerated.
         * @returns {Promise<number>} Number of distinct active endpoints found, or zero on failure.
         */
        function discoverEndpoints() {
            if (status) {
                status.textContent = "Reading the current official room list...";
            }
            return postFormJson("https://bonk2.io/scripts/getrooms.php", "version=49&gl=n&token=")
                .then(function (body) {
                    var rooms = body && Array.isArray(body.rooms) ? body.rooms.slice() : [];
                    if (!rooms.length) {
                        throw new Error("No public rooms were returned");
                    }
                    rooms.sort(function (left, right) {
                        return Number(left.longitude) - Number(right.longitude);
                    });
                    var sampled = [];
                    var buckets = Object.create(null);
                    rooms.forEach(function (room) {
                        var latitude = finiteCoordinate(room.latitude, -90, 90);
                        var longitude = finiteCoordinate(room.longitude, -180, 180);
                        var key = latitude === null || longitude === null ? "unknown" :
                            Math.floor((latitude + 90) / 20) + ":" + Math.floor((longitude + 180) / 30);
                        if (!buckets[key]) {
                            buckets[key] = true;
                            sampled.push(room);
                        }
                    });
                    rooms.forEach(function (room) {
                        if (sampled.length < 64 && sampled.indexOf(room) === -1) {
                            sampled.push(room);
                        }
                    });
                    sampled = sampled.slice(0, 64);

                    var cursor = 0;
                    var completed = 0;
                    var found = Object.create(null);
                    function worker() {
                        if (cursor >= sampled.length) {
                            return Promise.resolve();
                        }
                        var room = sampled[cursor];
                        cursor += 1;
                        return postFormJson("https://bonk2.io/scripts/getroomaddress.php",
                            "id=" + encodeURIComponent(room.id)).then(function (address) {
                            var server = cleanServer(address && address.server);
                            if (server) {
                                found[server] = true;
                                rememberEndpoint(server);
                                return queueLocation(server);
                            }
                        }).catch(function () {
                            // Rooms can close during a scan.
                        }).then(function () {
                            completed += 1;
                            if (status) {
                                status.textContent = "Indexing active rooms " + completed + "/" +
                                    sampled.length + "...";
                            }
                            return worker();
                        });
                    }

                    return Promise.all([worker(), worker(), worker()]).then(function () {
                        renderPicker();
                        var count = Object.keys(found).length;
                        if (status) {
                            status.textContent = "Index complete: " + count + " active endpoints found; " +
                                Object.keys(endpointCatalog).length + " saved.";
                        }
                        showToast("Endpoint index refreshed: " + count + " active locations found.");
                        return count;
                    });
                }).catch(function (error) {
                    if (status) {
                        status.textContent = "Endpoint scan failed: " + error.message;
                    }
                    showToast("Endpoint scan failed; the saved catalog is unchanged.");
                    return 0;
                });
        }

        function makeButton(text, className, action) {
            var button = gameDocument.createElement("button");
            button.type = "button";
            button.className = className || "bss-action";
            button.textContent = text;
            button.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                action(button);
            });
            return button;
        }

        /**
         * Draws bundled simplified coastlines in the same equirectangular projection as markers.
         * SVG paths are decorative and do not intercept pointer input.
         * @returns {void}
         */
        function renderContinents() {
            // Simplified coastlines in longitude/latitude, drawn in the same
            // equirectangular projection as the server markers. No remote assets.
            var outlines = [
                [[-168,71],[-155,71],[-141,69],[-130,70],[-120,74],[-100,77],[-82,73],[-65,60],[-55,53],[-60,47],[-67,45],[-74,40],[-76,35],[-81,25],[-83,29],[-90,29],[-97,26],[-97,20],[-90,18],[-86,16],[-83,10],[-77,8],[-81,8],[-87,13],[-93,15],[-105,20],[-111,24],[-117,32],[-124,40],[-128,50],[-140,60],[-151,60],[-160,55],[-166,60],[-162,65]],
                [[-73,60],[-60,60],[-43,60],[-23,70],[-20,80],[-40,84],[-60,82]],
                [[-81,12],[-71,12],[-61,10],[-51,4],[-35,-6],[-39,-16],[-44,-23],[-49,-29],[-54,-34],[-62,-40],[-66,-55],[-72,-51],[-75,-40],[-72,-28],[-75,-15],[-81,-5]],
                [[-10,36],[-10,43],[-2,44],[-5,49],[3,51],[8,55],[5,59],[10,64],[20,71],[30,71],[40,67],[60,69],[80,73],[105,77],[130,70],[160,70],[180,65],[180,58],[163,60],[155,51],[143,46],[135,35],[122,30],[120,22],[110,18],[106,10],[104,1],[99,7],[98,17],[90,22],[80,8],[75,10],[68,24],[58,22],[50,13],[43,13],[35,30],[27,40],[23,38],[20,40],[16,38],[12,45],[7,44],[3,42]],
                [[-17,21],[-17,15],[-10,5],[8,4],[10,-5],[13,-16],[18,-34],[26,-34],[35,-25],[40,-11],[44,2],[51,12],[43,11],[35,24],[32,31],[25,32],[10,37],[-2,35],[-10,30]],
                [[112,-22],[114,-34],[124,-34],[132,-32],[139,-38],[147,-39],[153,-28],[146,-17],[142,-11],[136,-13],[130,-12],[122,-17]],
                [[47,-13],[50,-16],[47,-25],[44,-25],[44,-18]],
                [[130,31],[134,34],[138,36],[141,41],[145,44],[143,38],[139,34]],
                [[-8,50],[-5,58],[-2,59],[1,52]], [[-10,51],[-10,55],[-6,55],[-6,52]],
                [[95,5],[106,-6],[102,-5]], [[108,7],[119,7],[117,-4],[110,-4]],
                [[130,-3],[140,-2],[151,-6],[146,-10],[135,-8]],
                [[172,-34],[178,-38],[175,-41],[172,-39]], [[172,-41],[168,-47],[166,-46],[169,-42]],
                [[-180,-75],[-140,-72],[-100,-74],[-65,-64],[-60,-73],[-20,-72],[20,-70],[70,-69],[110,-66],[150,-70],[180,-75],[180,-90],[-180,-90]]
            ];
            var svg = gameDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 360 180");
            svg.setAttribute("preserveAspectRatio", "none");
            svg.setAttribute("class", "bss-continents");
            svg.setAttribute("aria-hidden", "true");
            outlines.forEach(function (ring) {
                var path = gameDocument.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", ring.map(function (point, index) {
                    return (index ? "L" : "M") + (point[0] + 180) + " " + (90 - point[1]);
                }).join(" ") + "Z");
                path.setAttribute("vector-effect", "non-scaling-stroke");
                svg.appendChild(path);
            });
            map.appendChild(svg);
        }

        /**
         * Rebuilds the map and endpoint list from the catalog, skipping unknown map positions.
         * @param {boolean} [updateStatus=true] Whether to replace the current progress message.
         * @returns {void}
         */
        function renderPicker(updateStatus) {
            if (!map || !list) {
                return;
            }
            map.textContent = "";
            list.textContent = "";
            renderContinents();

            [
                ["North America", 19, 34], ["South America", 31, 69],
                ["Europe", 51, 29], ["Africa", 52, 55],
                ["Asia", 70, 36], ["Australia", 84, 72]
            ].forEach(function (entry) {
                var label = gameDocument.createElement("span");
                label.className = "bss-map-region";
                label.textContent = entry[0];
                label.style.left = entry[1] + "%";
                label.style.top = entry[2] + "%";
                map.appendChild(label);
            });

            var endpoints = Object.keys(endpointCatalog).map(function (server) {
                return endpointCatalog[server];
            }).sort(function (left, right) {
                return left.label.localeCompare(right.label);
            });

            endpoints.forEach(function (endpoint) {
                if (Number.isFinite(endpoint.latitude) && Number.isFinite(endpoint.longitude)) {
                    var marker = makeButton("", "bss-map-marker", function () {
                        setPreference("server", endpoint.server);
                    });
                    marker.style.left = ((endpoint.longitude + 180) / 360 * 100).toFixed(3) + "%";
                    marker.style.top = ((90 - endpoint.latitude) / 180 * 100).toFixed(3) + "%";
                    marker.title = endpointName(endpoint) +
                        (Number.isFinite(endpoint.lastPingMs) ? " - " + Math.round(endpoint.lastPingMs) + " ms" : "");
                    marker.setAttribute("aria-label", marker.title);
                    if (endpointPreference.mode === "server" && endpointPreference.server === endpoint.server) {
                        marker.classList.add("bss-selected");
                    }
                    map.appendChild(marker);
                }

                var row = makeButton("", "bss-endpoint-row", function () {
                    setPreference("server", endpoint.server);
                });
                var name = gameDocument.createElement("span");
                name.textContent = endpoint.label;
                var details = gameDocument.createElement("span");
                row.title = endpoint.locationSource === "ipwho.is" ?
                    "Approximate server IP location (ipwho.is)" :
                    (endpoint.locationSource === "catalog" ? "Mapped server location" :
                        "Location unknown; automatic lookup pending or unavailable");
                details.textContent = endpoint.server +
                    (!Number.isFinite(endpoint.latitude) || !Number.isFinite(endpoint.longitude) ?
                        " — location unknown" : "") +
                    (Number.isFinite(endpoint.lastPingMs) ? "  " + Math.round(endpoint.lastPingMs) + " ms" : "");
                row.appendChild(name);
                row.appendChild(details);
                if (endpointPreference.mode === "server" && endpointPreference.server === endpoint.server) {
                    row.classList.add("bss-selected");
                }
                list.appendChild(row);
            });

            updateServerButton();
            if (updateStatus !== false && status) {
                var selected = selectedEndpoint();
                if (!selected) {
                    status.textContent = "Automatic: Bonk will choose the room server.";
                } else if (!allocationOverrideAvailable) {
                    status.textContent = "The startup allocation hook is unavailable; Bonk automatic is being used for safety.";
                } else {
                    status.textContent = "Loaded for " + endpointName(selected) +
                        (allocationOverrideObserved ? ". Server preference applied to the room-list response." :
                            ". Waiting for Bonk to request its room list.") +
                        " Public country/distance remain network-based.";
                }
            }
        }

        function openPicker() {
            if (picker) {
                picker.style.display = "flex";
                renderPicker();
            }
        }

        function closePicker() {
            if (picker) {
                picker.style.display = "none";
            }
        }

        /**
         * Adds the Create Game server button and map/list picker once Bonk's DOM is ready.
         * @returns {boolean} Whether the controls are installed.
         */
        function installUi() {
            if (picker) {
                return true;
            }
            var createWindow = gameDocument.getElementById("roomlistcreatewindow");
            var createWindowContainer = gameDocument.getElementById("roomlistcreatewindowcontainer");
            var createButton = gameDocument.getElementById("roomlistcreatecreatebutton");
            if (!createWindow || !createButton || !gameDocument.body || !gameDocument.head) {
                return false;
            }

            var style = gameDocument.createElement("style");
            style.textContent =
                "#bss-create-control{position:absolute;left:31px;top:316px;width:200px;height:30px;z-index:3;}" +
                "#bss-server-button{width:100%;height:30px;border:0;border-radius:3px;background:#31506b;color:#fff;font:14px Arial,sans-serif;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 8px;}" +
                "#bss-picker{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;background:rgba(8,14,22,.82);font:14px Arial,sans-serif;color:#eef7ff;}" +
                ".bss-panel{width:min(850px,94vw);height:min(555px,92vh);box-sizing:border-box;background:#172431;border:1px solid #55758e;border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,.65);padding:14px;display:grid;grid-template-columns:minmax(360px,1.55fr) minmax(230px,.9fr);grid-template-rows:auto auto minmax(0,1fr) auto;gap:10px;}" +
                ".bss-title{grid-column:1/3;font-size:20px;font-weight:bold;display:flex;align-items:center;justify-content:space-between;}" +
                ".bss-actions{grid-column:1/3;display:flex;gap:8px;flex-wrap:wrap;}" +
                ".bss-action,.bss-close,.bss-endpoint-row{border:1px solid #5f8199;background:#29445a;color:#eef7ff;border-radius:4px;cursor:pointer;padding:7px 10px;}" +
                ".bss-action:hover,.bss-close:hover,.bss-endpoint-row:hover{background:#38617e;}" +
                ".bss-close{padding:3px 9px;font-size:18px;}" +
                ".bss-map{position:relative;min-height:260px;overflow:hidden;border:1px solid #48677d;border-radius:6px;background-color:#20394a;background-image:linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px);background-size:12.5% 25%;}" +
                ".bss-continents{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;fill:#345565;stroke:#90b1bd;stroke-width:1;stroke-linejoin:round;}" +
                ".bss-map-region{position:absolute;transform:translate(-50%,-50%);color:rgba(220,239,249,.55);font-size:14px;font-weight:bold;pointer-events:none;white-space:nowrap;}" +
                ".bss-map-marker{position:absolute;width:14px;height:14px;transform:translate(-50%,-50%);border:2px solid #fff;border-radius:50%;background:#23b9e4;box-shadow:0 0 0 2px rgba(0,0,0,.45);cursor:pointer;padding:0;}" +
                ".bss-map-marker:hover{width:18px;height:18px;background:#65d9fa;z-index:5;}" +
                ".bss-map-marker.bss-selected{background:#ffd34f;box-shadow:0 0 0 3px #d88700;}" +
                ".bss-list{overflow:auto;border:1px solid #48677d;border-radius:6px;padding:5px;display:flex;flex-direction:column;gap:5px;}" +
                ".bss-endpoint-row{display:flex;justify-content:space-between;gap:9px;text-align:left;padding:6px 8px;}" +
                ".bss-endpoint-row span:last-child{opacity:.72;font-size:11px;white-space:nowrap;}" +
                ".bss-endpoint-row.bss-selected{border-color:#ffd34f;background:#594c24;}" +
                ".bss-status{grid-column:1/3;min-height:18px;color:#b9d8e8;}" +
                "#bss-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483640;display:none;max-width:80vw;padding:9px 14px;border-radius:5px;background:rgba(17,35,48,.96);border:1px solid #6b91aa;color:#fff;font:14px Arial,sans-serif;box-shadow:0 5px 20px rgba(0,0,0,.5);}" +
                "@media(max-width:700px){.bss-panel{grid-template-columns:1fr;height:94vh;}.bss-title,.bss-actions,.bss-status{grid-column:1}.bss-map{min-height:220px}.bss-list{max-height:170px}}";
            gameDocument.head.appendChild(style);

            if (createWindowContainer) {
                createWindowContainer.style.height = "405px";
            }
            createWindow.style.height = "405px";
            createButton.style.top = "360px";
            var control = gameDocument.createElement("div");
            control.id = "bss-create-control";
            serverButton = makeButton("Server: Automatic", "", openPicker);
            serverButton.id = "bss-server-button";
            control.appendChild(serverButton);
            createWindow.appendChild(control);

            picker = gameDocument.createElement("div");
            picker.id = "bss-picker";
            var panel = gameDocument.createElement("div");
            panel.className = "bss-panel";
            var title = gameDocument.createElement("div");
            title.className = "bss-title";
            var titleText = gameDocument.createElement("span");
            titleText.textContent = "Official Bonk room servers";
            var close = makeButton("×", "bss-close", closePicker);
            title.appendChild(titleText);
            title.appendChild(close);
            panel.appendChild(title);

            var actions = gameDocument.createElement("div");
            actions.className = "bss-actions";
            actions.appendChild(makeButton("Bonk automatic", "bss-action", function () {
                setPreference("auto", "");
            }));
            actions.appendChild(makeButton("Test and choose fastest", "bss-action", function (button) {
                button.disabled = true;
                testAndSelectFastest().finally(function () { button.disabled = false; });
            }));
            actions.appendChild(makeButton("Refresh endpoint index", "bss-action", function (button) {
                button.disabled = true;
                discoverEndpoints().finally(function () { button.disabled = false; });
            }));
            panel.appendChild(actions);

            map = gameDocument.createElement("div");
            map.className = "bss-map";
            panel.appendChild(map);
            list = gameDocument.createElement("div");
            list.className = "bss-list";
            panel.appendChild(list);
            status = gameDocument.createElement("div");
            status.className = "bss-status";
            panel.appendChild(status);
            picker.appendChild(panel);
            picker.addEventListener("click", function (event) {
                if (event.target === picker) {
                    closePicker();
                }
            });
            gameDocument.body.appendChild(picker);
            gameDocument.addEventListener("keydown", function (event) {
                if (event.key === "Escape" && picker.style.display !== "none") {
                    closePicker();
                }
            });

            renderPicker();
            return true;
        }

        installAllocationHook();
        if (!installUi()) {
            var uiPoll = gameWindow.setInterval(function () {
                if (installUi()) {
                    gameWindow.clearInterval(uiPoll);
                }
            }, 500);
            gameWindow.setTimeout(function () { gameWindow.clearInterval(uiPoll); }, 30000);
        }
    }
})();
