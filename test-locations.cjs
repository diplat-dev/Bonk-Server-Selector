const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const source = fs.readFileSync(__dirname + "/BonkServerSelector.user.js", "utf8");
function extract(name, next) {
    return source.slice(source.indexOf("function " + name + "("),
        source.indexOf("function " + next + "("));
}
const context = vm.createContext({});
vm.runInContext(
    extract("seedEndpoints", "validServer") +
    extract("validServer", "readPreference") +
    "function cleanServer(value) { return validServer(value); }\n" +
    extract("finiteCoordinate", "sanitizeEndpoint") +
    extract("sanitizeEndpoint", "loadEndpointCatalog"), context);
for (const input of [null, undefined, "", " ", false, [], {}]) {
    assert.equal(context.finiteCoordinate(input, -90, 90), null);
}
assert.equal(context.finiteCoordinate(0, -90, 90), 0);
assert.equal(context.finiteCoordinate("37.5", -90, 90), 37.5);
const seoul = context.sanitizeEndpoint({
    server: "b2seoul1", label: "b2seoul1", latitude: 0, longitude: 0
}, null);
assert.equal(seoul.label, "Seoul, South Korea");
assert.equal(seoul.country, "KR");
assert.equal(seoul.latitude, 37.566);
assert.equal(seoul.longitude, 126.9784);
let unknown = context.sanitizeEndpoint({
    server: "b2unknown1", latitude: 0, longitude: 0
}, null);
assert.equal(unknown.latitude, null);
unknown = context.sanitizeEndpoint(JSON.parse(JSON.stringify(unknown)), unknown);
assert.equal(unknown.longitude, null);
const located = context.sanitizeEndpoint({
    server: "b2new1", label: "Seoul, South Korea", country: "KR",
    latitude: 37.566, longitude: 126.9784, locationSource: "ipwho.is",
    locationCheckedAt: 1234
}, null);
assert.equal(located.latitude, 37.566);
assert.equal(located.country, "KR");
assert.equal(located.locationCheckedAt, 1234);
assert.equal(context.sanitizeEndpoint({ server: "b2new1", lastPingMs: null }, null).lastPingMs, null);
assert.equal(context.validServer("https://example.com"), "");
console.log("PASS: coordinate validation, bundled Seoul, geolocation cache, unknown latency, aliases");
